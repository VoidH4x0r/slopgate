import { chmod, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ScanFix } from './types.ts';

export interface FixApplyResult {
  fixedFindings: number;
  fixedFiles: string[];
  skippedFindings: number;
  warnings: string[];
}

interface FilePlan {
  file: string;
  sourceHash: string;
  findings: number;
  edits: Array<{ start: number; end: number; replacement: string }>;
}

/**
 * Apply safe edits. Offsets are UTF-16 positions in the BOM-stripped source;
 * a file is written atomically and only after every edit has been validated.
 */
export async function applyFixes(
  fixes: readonly ScanFix[],
  options: { write: boolean },
): Promise<FixApplyResult> {
  const byFile = new Map<string, FilePlan>();
  for (const fix of fixes) {
    const existing = byFile.get(fix.fileAbs);
    if (existing && existing.sourceHash !== fix.sourceHash) {
      existing.findings += 1;
      existing.sourceHash = '\u0000mismatch';
      continue;
    }
    const plan = existing ?? {
      file: fix.fileAbs,
      sourceHash: fix.sourceHash,
      findings: 0,
      edits: [],
    };
    plan.findings += 1;
    for (const edit of fix.edits) {
      plan.edits.push({ ...edit });
    }
    byFile.set(fix.fileAbs, plan);
  }

  const result: FixApplyResult = { fixedFindings: 0, fixedFiles: [], skippedFindings: 0, warnings: [] };
  for (const plan of byFile.values()) {
    let raw: Buffer;
    try {
      raw = await readFile(plan.file);
    } catch (error) {
      result.skippedFindings += plan.findings;
      result.warnings.push(`could not read ${plan.file} for fixing: ${(error as Error).message}`);
      continue;
    }
    const hadBom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
    const source = raw.toString('utf8').replace(/^\uFEFF/, '');
    if (plan.sourceHash === '\u0000mismatch' || plan.sourceHash !== createHash('sha1').update(source).digest('hex')) {
      result.skippedFindings += plan.findings;
      result.warnings.push(`skipped fixes in ${plan.file}: the file changed after it was scanned`);
      continue;
    }
    const unique = new Map<string, { start: number; end: number; replacement: string }>();
    for (const edit of plan.edits) {
      const key = `${edit.start}:${edit.end}:${edit.replacement}`;
      if (!unique.has(key)) unique.set(key, edit);
    }
    const edits = [...unique.values()].sort((a, b) => b.start - a.start || b.end - a.end);
    let lastStart = source.length;
    let invalid = false;
    for (const edit of edits) {
      if (edit.start < 0 || edit.end < edit.start || edit.end > source.length || edit.end > lastStart) {
        invalid = true;
        break;
      }
      lastStart = edit.start;
    }
    if (invalid) {
      result.skippedFindings += plan.findings;
      result.warnings.push(`skipped overlapping or invalid fixes in ${plan.file}`);
      continue;
    }

    let updated = source;
    for (const edit of edits) {
      updated = updated.slice(0, edit.start) + edit.replacement + updated.slice(edit.end);
    }
    if (updated === source) continue;

    if (!options.write) {
      result.fixedFindings += plan.findings;
      result.fixedFiles.push(plan.file);
      continue;
    }

    const info = await stat(plan.file).catch(() => undefined);
    const temp = `${plan.file}.slopgate-fix-${process.pid}-${Date.now()}.tmp`;
    try {
      await writeFile(temp, (hadBom ? '\uFEFF' : '') + updated, 'utf8');
      if (info) await chmod(temp, info.mode).catch(() => undefined);
      await rename(temp, plan.file);
      result.fixedFindings += plan.findings;
      result.fixedFiles.push(plan.file);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      result.skippedFindings += plan.findings;
      result.warnings.push(`could not write ${plan.file}: ${(error as Error).message}`);
    }
  }
  return result;
}
