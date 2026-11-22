import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { Finding } from './types.ts';

const exec = promisify(execFile);

const DIFF_HEADER = /^diff --git (.+)$/;
const NEW_FILE = /^\+\+\+ (.+)$/;
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export interface DiffSet {
  /** Files with per-line additions. */
  lines: Map<string, Set<number>>;
  /** Files where the whole file is new (untracked or added). */
  full: Set<string>;
}

/**
 * Git quotes paths that contain spaces, quotes or non-ASCII bytes, and appends
 * a tab when the path contains a space. `core.quotePath=false` avoids the octal
 * escaping, but quote/backslash escaping still happens, so normalise both.
 */
export function normalizeGitPath(raw: string): string {
  let value = raw;
  const tab = value.indexOf('\t');
  if (tab !== -1) value = value.slice(0, tab);

  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    const inner = value.slice(1, -1);
    const bytes: number[] = [];
    for (let index = 0; index < inner.length; index += 1) {
      const ch = inner[index] ?? '';
      if (ch !== '\\') {
        bytes.push(...Buffer.from(ch, 'utf8'));
        continue;
      }
      const next = inner[index + 1];
      index += 1;
      switch (next) {
        case 'n':
          bytes.push(0x0a);
          break;
        case 'r':
          bytes.push(0x0d);
          break;
        case 't':
          bytes.push(0x09);
          break;
        case '"':
        case '\\':
          bytes.push(next.charCodeAt(0));
          break;
        case undefined:
          break;
        default:
          if (/[0-7]/.test(next)) {
            let octal = next;
            while (octal.length < 3 && /[0-7]/.test(inner[index + 1] ?? '')) {
              index += 1;
              octal += inner[index];
            }
            bytes.push(Number.parseInt(octal, 8));
          } else {
            bytes.push(next.charCodeAt(0));
          }
      }
    }
    value = Buffer.from(bytes).toString('utf8');
  }

  if (value.startsWith('b/')) value = value.slice(2);
  return value;
}

async function git(root: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', ['-c', 'core.quotePath=false', ...args], {
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const message = (error as { stderr?: string }).stderr?.trim() || (error as Error).message;
    throw new Error(`git ${args.join(' ')} failed: ${message}`);
  }
}

/**
 * `git diff` parses options anywhere before `--`, so a ref beginning with `-`
 * (`--diff=--output=file`) would be interpreted as a git flag. Reject it.
 */
export function assertSafeRef(ref: string): string {
  if (ref.length === 0) throw new Error('empty git ref');
  if (ref.startsWith('-')) throw new Error(`invalid git ref: ${ref}`);
  return ref;
}

export function parseUnifiedDiff(stdout: string): DiffSet {
  const set: DiffSet = { lines: new Map(), full: new Set() };
  let currentFile: string | undefined;
  let previousWasDevNull = false;
  /** Content lines left in the current hunk, tracked per side. */
  let oldRemaining = 0;
  let newRemaining = 0;
  /** Next line number in the new file. */
  let newLine = 0;
  let store: Set<number> | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    // Inside a hunk every line is content, even one that looks like a header:
    // JavaScript `++ x;` produces a `+++ x;` line. Consume by hunk counts.
    if (oldRemaining > 0 || newRemaining > 0) {
      if (line.startsWith('\\')) continue; // "\ No newline at end of file"
      if (line.startsWith('+')) {
        if (newRemaining > 0) {
          if (!store && currentFile) {
            store = new Set<number>();
            set.lines.set(currentFile, store);
          }
          store?.add(newLine);
          newLine += 1;
          newRemaining -= 1;
        }
      } else if (line.startsWith('-')) {
        if (oldRemaining > 0) oldRemaining -= 1;
      } else if (line.startsWith(' ')) {
        if (oldRemaining > 0) oldRemaining -= 1;
        if (newRemaining > 0) {
          newLine += 1;
          newRemaining -= 1;
        }
      } else {
        // Malformed hunk: consume defensively rather than parsing it as a header.
        if (oldRemaining > 0) oldRemaining -= 1;
        if (newRemaining > 0) newRemaining -= 1;
      }
      continue;
    }

    if (line.startsWith('--- ')) {
      previousWasDevNull = line.trim() === '--- /dev/null';
      continue;
    }
    const newFile = NEW_FILE.exec(line);
    if (newFile?.[1] && newFile[1] !== '/dev/null') {
      currentFile = normalizeGitPath(newFile[1]);
      if (previousWasDevNull) set.full.add(currentFile);
      previousWasDevNull = false;
      continue;
    }
    previousWasDevNull = false;
    const header = DIFF_HEADER.exec(line);
    if (header?.[1] && currentFile === undefined) {
      // Fallback for binary diffs, which have no `+++` line.
      const match = /^"?a\/(.+?)"? "?b\/(.+?)"?$/.exec(header[1]);
      if (match?.[2]) currentFile = normalizeGitPath(match[2]);
      continue;
    }
    if (!currentFile) continue;
    const hunk = HUNK.exec(line);
    if (!hunk?.[1] || !hunk[3]) continue;
    oldRemaining = hunk[2] === undefined ? 1 : Number.parseInt(hunk[2], 10);
    newRemaining = hunk[4] === undefined ? 1 : Number.parseInt(hunk[4], 10);
    newLine = Number.parseInt(hunk[3], 10);
    if (!Number.isFinite(newLine)) continue;
    store = currentFile ? set.lines.get(currentFile) : undefined;
  }
  return set;
}

/** Lines that differ from `ref`, plus every line of untracked files. */
export async function diffSince(root: string, ref: string): Promise<DiffSet> {
  const safeRef = assertSafeRef(ref);
  const stdout = await git(root, ['diff', '--unified=0', '--no-color', '--no-ext-diff', safeRef, '--']);
  const set = parseUnifiedDiff(stdout);

  // `-z` gives NUL-separated raw paths, immune to quoting and newlines in names.
  const untracked = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']).catch(() => '');
  for (const file of untracked.split('\u0000')) {
    if (file.length > 0) set.full.add(file);
  }
  return set;
}

export function isInDiff(finding: Finding, set: DiffSet): boolean {
  if (set.full.has(finding.file)) return true;
  const lines = set.lines.get(finding.file);
  if (!lines) return false;
  for (let line = finding.start.line; line <= Math.max(finding.start.line, finding.end.line); line += 1) {
    if (lines.has(line)) return true;
  }
  return false;
}

/**
 * Findings carry paths relative to the scan target. When the target is a
 * subdirectory (or a single file) of the repository, prepend the relative
 * prefix before comparing against git's repository-root paths.
 */
export function isInDiffWithPrefix(finding: Finding, set: DiffSet, prefix: string): boolean {
  if (isInDiff(finding, set)) return true;
  const clean = prefix.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (clean.length === 0 || clean.startsWith('..')) return false;
  return isInDiff({ ...finding, file: `${clean}/${finding.file}` }, set);
}

/** Repository root for a path inside a git working tree. */
export async function findRepoRoot(start: string): Promise<string> {
  const stdout = await git(start, ['rev-parse', '--show-toplevel']);
  const root = stdout.trim();
  if (root.length === 0) throw new Error('not inside a git repository');
  return path.resolve(root);
}
