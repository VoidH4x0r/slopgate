import { createHash } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
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
  version: 1;
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
  const material = `${finding.ruleId}\n${finding.file}\n${normalizeSnippet(finding.snippet)}`;
  return createHash('sha1').update(material).digest('hex').slice(0, 16);
}

export async function loadBaseline(file: string): Promise<BaselineFile | undefined> {
  let text;
  try {
    text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as Partial<BaselineFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      throw new Error('unexpected shape');
    }
    return {
      version: 1,
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
    version: 1,
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
): Promise<BaselineFile> {
  const existing = await loadBaseline(file);
  const scanned = new Set(scannedFiles);
  const current = entriesFromFindings(findings);
  const currentFingerprints = new Set(current.map((entry) => entry.fingerprint));
  const preserved = (existing?.entries ?? []).filter(
    (entry) =>
      (!scanned.has(entry.file) || (onlyRules !== undefined && !onlyRules.has(entry.ruleId))) &&
      !currentFingerprints.has(entry.fingerprint),
  );
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
    const fingerprint = findingFingerprint(finding);
    const left = remaining.get(fingerprint) ?? 0;
    if (left > 0) {
      known.push(finding);
      remaining.set(fingerprint, left - 1);
    } else {
      fresh.push(finding);
    }
  }
  return { fresh, known };
}
