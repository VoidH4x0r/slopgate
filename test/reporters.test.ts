import assert from 'node:assert/strict';
import test from 'node:test';
import { renderJson } from '../src/reporters/json.ts';
import { renderPretty } from '../src/reporters/pretty.ts';
import { renderSarif } from '../src/reporters/sarif.ts';
import type { Finding, ScanStats } from '../src/types.ts';

const stats: ScanStats = {
  files: 2,
  byLanguage: { python: 1, javascript: 0, typescript: 1, tsx: 0 },
  skipped: 0,
  parseErrors: 0,
  durationMs: 12,
};

const findings: Finding[] = [
  {
    ruleId: 'py/phantom-import',
    message: '`numpy_v2` is imported but not declared',
    severity: 'error',
    confidence: 'high',
    file: 'app.py',
    start: { line: 4, column: 1 },
    end: { line: 4, column: 18 },
    snippet: 'import numpy_v2',
    evidence: ['manifests checked: pyproject.toml'],
    help: 'Add it to your manifest.',
  },
];

test('renderJson produces a stable machine-readable document', () => {
  const parsed = JSON.parse(
    renderJson({ findings, stats, version: '0.1.0', suppressedByComment: 0, baselined: 0, hiddenByConfidence: 0 }),
  ) as {
    tool: string;
    findings: Array<{ fingerprint: string; ruleId: string }>;
    summary: { findings: number; bySeverity: { error: number } };
  };
  assert.equal(parsed.tool, 'slopgate');
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0]?.ruleId, 'py/phantom-import');
  assert.equal(parsed.findings[0]?.fingerprint.length, 16);
  assert.equal(parsed.summary.bySeverity.error, 1);
});

test('renderSarif emits a valid SARIF 2.1.0 skeleton', () => {
  const parsed = JSON.parse(renderSarif(findings, '0.1.0')) as {
    version: string;
    runs: Array<{
      tool: { driver: { name: string; rules: Array<{ id: string }> } };
      results: Array<{ ruleId: string; level: string; locations: unknown[]; partialFingerprints: Record<string, string> }>;
    }>;
  };
  assert.equal(parsed.version, '2.1.0');
  assert.equal(parsed.runs[0]?.tool.driver.name, 'slopgate');
  assert.equal(parsed.runs[0]?.tool.driver.rules[0]?.id, 'py/phantom-import');
  assert.equal(parsed.runs[0]?.results[0]?.level, 'error');
  assert.equal(parsed.runs[0]?.results[0]?.locations.length, 1);
  assert.ok(parsed.runs[0]?.results[0]?.partialFingerprints.primaryLocationLineHash);
});

test('renderSarif percent-encodes artifact URIs', () => {
  const [finding] = findings;
  assert.ok(finding);
  const parsed = JSON.parse(renderSarif([{ ...finding, file: 'src/brand new#1.py' }], '0.1.0')) as {
    runs: Array<{
      results: Array<{ locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }> }>;
    }>;
  };
  assert.equal(
    parsed.runs[0]?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri,
    'src/brand%20new%231.py',
  );
});

test('renderPretty shows location, message and summary', () => {
  const output = renderPretty({
    findings,
    stats,
    suppressedByComment: 2,
    baselined: 1,
    hiddenByConfidence: 0,
    version: '0.1.0',
    color: false,
  });
  assert.ok(output.includes('app.py'));
  assert.ok(output.includes('4:1'));
  assert.ok(output.includes('numpy_v2'));
  assert.ok(output.includes('1 finding in 1 file'));
  assert.ok(output.includes('2 suppressed by comment'));
  assert.ok(output.includes('1 in baseline'));
});

test('renderPretty with quiet keeps the summary but drops findings', () => {
  const output = renderPretty({
    findings,
    stats,
    suppressedByComment: 0,
    baselined: 0,
    hiddenByConfidence: 0,
    version: '0.1.0',
    color: false,
    quiet: true,
  });
  assert.ok(output.includes('1 finding in 1 file'));
  assert.ok(!output.includes('numpy_v2'));
});

test('renderPretty reports a clean run', () => {
  const output = renderPretty({
    findings: [],
    stats,
    suppressedByComment: 0,
    baselined: 0,
    hiddenByConfidence: 0,
    version: '0.1.0',
    color: false,
  });
  assert.ok(output.includes('no findings'));
  assert.ok(output.includes('0 findings in 0 files'));
});
