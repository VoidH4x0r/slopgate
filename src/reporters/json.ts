import type { Finding, ScanStats } from '../types.ts';
import { findingFingerprint } from '../baseline.ts';

export interface JsonInput {
  findings: readonly Finding[];
  stats: ScanStats;
  version: string;
  reportRoot: string;
  suppressedByComment: number;
  baselined: number;
  hiddenByConfidence: number;
}

export function renderJson(input: JsonInput): string {
  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byConfidence = { high: 0, medium: 0, low: 0 };
  for (const finding of input.findings) {
    bySeverity[finding.severity] += 1;
    byConfidence[finding.confidence] += 1;
  }

  const payload = {
    tool: 'slopgate',
    version: input.version,
    reportRoot: input.reportRoot,
    stats: input.stats,
    summary: {
      findings: input.findings.length,
      bySeverity,
      byConfidence,
      suppressedByComment: input.suppressedByComment,
      baselined: input.baselined,
      hiddenByConfidence: input.hiddenByConfidence,
    },
    findings: input.findings.map((finding) => ({
      ruleId: finding.ruleId,
      severity: finding.severity,
      confidence: finding.confidence,
      file: finding.file,
      start: finding.start,
      end: finding.end,
      message: finding.message,
      snippet: finding.snippet,
      evidence: finding.evidence,
      ...(finding.help ? { help: finding.help } : {}),
      fingerprint: findingFingerprint(finding),
    })),
  };
  return JSON.stringify(payload, null, 2) + '\n';
}
