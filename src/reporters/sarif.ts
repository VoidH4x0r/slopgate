import { findingFingerprint } from '../baseline.ts';
import { ALL_RULE_BY_ID } from '../rules/index.ts';
import type { Finding } from '../types.ts';

const SARIF_LEVEL: Record<Finding['severity'], 'error' | 'warning' | 'note'> = {
  error: 'error',
  warning: 'warning',
  info: 'note',
};

function encodeUriPath(file: string): string {
  // Each segment is encoded separately so `/` stays a path separator while
  // spaces, `#`, `?` and non-ASCII characters become valid URI references.
  return file.split('/').map(encodeURIComponent).join('/');
}

export function renderSarif(findings: readonly Finding[], version: string): string {
  const usedRules = new Map<string, Finding>();
  for (const finding of findings) {
    if (!usedRules.has(finding.ruleId)) usedRules.set(finding.ruleId, finding);
  }

  const rules = [...usedRules.entries()].map(([ruleId, finding]) => {
    const meta = ALL_RULE_BY_ID.get(ruleId)?.meta;
    return {
      id: ruleId,
      name: meta?.title ?? ruleId,
      shortDescription: { text: meta?.title ?? ruleId },
      fullDescription: { text: meta?.summary ?? '' },
      defaultConfiguration: { level: SARIF_LEVEL[finding.severity] },
      properties: {
        confidence: meta?.confidence ?? finding.confidence,
        tags: meta?.tags ?? [],
      },
    };
  });

  const payload = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'slopgate',
            version,
            informationUri: 'https://github.com/VoidH4x0r/slopgate',
            rules,
          },
        },
        results: findings.map((finding) => ({
          ruleId: finding.ruleId,
          level: SARIF_LEVEL[finding.severity],
          message: { text: finding.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: encodeUriPath(finding.file) },
                region: {
                  startLine: finding.start.line,
                  startColumn: finding.start.column,
                  endLine: finding.end.line,
                  endColumn: finding.end.column,
                },
              },
            },
          ],
          partialFingerprints: {
            primaryLocationLineHash: findingFingerprint(finding),
          },
          properties: {
            confidence: finding.confidence,
            evidence: finding.evidence,
          },
        })),
      },
    ],
  };
  return JSON.stringify(payload, null, 2) + '\n';
}
