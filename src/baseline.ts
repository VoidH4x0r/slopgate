import { createHash } from 'node:crypto';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Finding } from './types.ts';

export interface BaselineEntry {
  fingerprint: string;
  ruleId: string;
  file: string;
  /**
   * How many findings shared this fingerprint when the baseline was written.
   * Optional for backwards compatibility: older baselines implied 1.
   */
  count?: number;
}

export interface BaselineFile {
  version: 1 | 2;
  createdAt: string;
  entries: BaselineEntry[];
}

function normalizeSnippet(snippet: string): string {
  return snippet.replace(/\s+/g, ' ').trim();
}

/**
 * Stable across line moves: it is built from the rule, the file and the
 * offending source text, not from the line number.
 */
export function findingFingerprint(finding: Finding): string {
  const material = `${finding.ruleId}\n${finding.file}\n${normalizeSnippet(finding.snippet)}\n${finding.message}`;
  return createHash('sha1').update(material).digest('hex').slice(0, 16);
}

/** Fingerprint used by baseline version 1, before messages were included. */
export function legacyFindingFingerprint(finding: Finding): string {
  const material = `${finding.ruleId}\n${finding.file}\n${normalizeSnippet(finding.snippet)}`;
  return createHash('sha1').update(material).digest('hex').slice(0, 16);
}

export async function loadBaseline(file: string): Promise<BaselineFile | undefined> {
  let text;
  try {
    text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if ((error as NodeJS.ErrnoException).code === 'EISDIR') {
      throw new Error(`${file} is a directory, not a baseline file`);
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as Partial<BaselineFile>;
    if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.entries)) {
      throw new Error('unexpected shape');
    }
    return {
      version: parsed.version === 2 ? 2 : 1,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date(0).toISOString(),
      entries: parsed.entries
        .filter(
          (entry): entry is BaselineEntry =>
            typeof entry?.fingerprint === 'string' &&
            typeof entry?.ruleId === 'string' &&
            typeof entry?.file === 'string',
        )
        .map((entry) => ({
          fingerprint: entry.fingerprint,
          ruleId: entry.ruleId,
          file: entry.file,
          ...(typeof entry.count === 'number' && entry.count > 0 ? { count: entry.count } : {}),
        })),
    };
  } catch (error) {
    throw new Error(`${file} is not a valid baseline (${(error as Error).message})`);
  }
}

function entriesFromFindings(findings: readonly Finding[]): BaselineEntry[] {
  const groups = new Map<string, BaselineEntry>();
  for (const finding of findings) {
    const fingerprint = findingFingerprint(finding);
    const existing = groups.get(fingerprint);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      continue;
    }
    groups.set(fingerprint, {
      fingerprint,
      ruleId: finding.ruleId,
      file: finding.file,
      count: 1,
    });
  }
  return [...groups.values()];
}

/** Write a baseline atomically so a failure cannot truncate the old file. */
async function writeBaselineEntries(
  file: string,
  entries: readonly BaselineEntry[],
): Promise<BaselineFile> {
  const baseline: BaselineFile = {
    version: 2,
    createdAt: new Date().toISOString(),
    entries: [...entries],
  };
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return baseline;
}

export async function writeBaseline(file: string, findings: readonly Finding[]): Promise<BaselineFile> {
  return writeBaselineEntries(file, entriesFromFindings(findings));
}

/**
 * Update only the part of the baseline covered by this scan: entries for files
 * outside the scanned set, or for rules not selected by `--rule`, are kept.
 */
export async function mergeBaseline(
  file: string,
  findings: readonly Finding[],
  scannedFiles: readonly string[],
  onlyRules?: ReadonlySet<string>,
  root?: string,
  disabledRules?: ReadonlySet<string>,
): Promise<BaselineFile> {
  const existing = await loadBaseline(file);
  const scanned = new Set(scannedFiles);
  const current = entriesFromFindings(findings);
  const currentFingerprints = new Set(current.map((entry) => entry.fingerprint));
  const preserved: BaselineEntry[] = [];
  for (const entry of existing?.entries ?? []) {
    const outsideScope = !scanned.has(entry.file);
    const ruleNotSelected =
      (onlyRules !== undefined && !onlyRules.has(entry.ruleId)) ||
      Boolean(disabledRules?.has(entry.ruleId));
    if (!outsideScope && !ruleNotSelected) continue;
    if (currentFingerprints.has(entry.fingerprint)) continue;
    // A baseline kept for a deleted file grows forever. When the caller gives
    // us the baseline root, prune entries whose file no longer exists; entries
    // for files outside the scan scope but still present are preserved.
    if (root) {
      const exists = await stat(path.resolve(root, entry.file)).then(
        () => true,
        () => false,
      );
      if (!exists) continue;
    }
    preserved.push(entry);
  }
  return writeBaselineEntries(file, [...preserved, ...current]);
}

export interface BaselinePartition {
  fresh: Finding[];
  known: Finding[];
}

function ordered(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.start.line - b.start.line ||
      a.start.column - b.start.column ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

/**
 * Matches findings against the baseline by fingerprint **and remaining count**.
 * Without the count, adding a second identical `except: pass` to a file would
 * be silently absorbed by the baseline entry for the first one.
 */
export function partitionByBaseline(
  findings: readonly Finding[],
  baseline: BaselineFile | undefined,
): BaselinePartition {
  if (!baseline) return { fresh: [...findings], known: [] };

  const remaining = new Map<string, number>();
  for (const entry of baseline.entries) {
    remaining.set(entry.fingerprint, (remaining.get(entry.fingerprint) ?? 0) + (entry.count ?? 1));
  }

  const fresh: Finding[] = [];
  const known: Finding[] = [];
  for (const finding of ordered(findings)) {
    const candidates =
      baseline.version === 1
        ? [findingFingerprint(finding), legacyFindingFingerprint(finding)]
        : [findingFingerprint(finding)];
    let matched: string | undefined;
    for (const fingerprint of candidates) {
      if ((remaining.get(fingerprint) ?? 0) > 0) {
        matched = fingerprint;
        break;
      }
    }
    if (matched) {
      known.push(finding);
      remaining.set(matched, (remaining.get(matched) ?? 0) - 1);
    } else {
      fresh.push(finding);
    }
  }
  return { fresh, known };
}
