import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_RULE_METAS } from '../src/rules/index.ts';
import { renderJson } from '../src/reporters/json.ts';
import { renderSarif } from '../src/reporters/sarif.ts';
import type { Finding, ScanStats } from '../src/types.ts';

const RULE_IDS = [
  'go/duplicate-block',
  'go/noop-test',
  'go/phantom-import',
  'go/semantic-duplicate',
  'go/stub-body',
  'go/swallowed-error',
  'go/unreachable',
  'py/dead-branch',
  'py/duplicate-block',
  'py/noop-test',
  'py/phantom-import',
  'py/semantic-duplicate',
  'py/stub-body',
  'py/swallowed-exception',
  'py/tautological-assert',
  'py/unreachable',
  'rs/duplicate-block',
  'rs/noop-test',
  'rs/phantom-import',
  'rs/semantic-duplicate',
  'rs/stub-body',
  'rs/swallowed-error',
  'rs/unreachable',
  'ts/dead-branch',
  'ts/duplicate-block',
  'ts/noop-test',
  'ts/phantom-import',
  'ts/semantic-duplicate',
  'ts/stub-function',
  'ts/swallowed-exception',
  'ts/tautological-assert',
  'ts/unreachable',
];

const finding: Finding = {
  ruleId: 'py/unreachable',
  message: 'code after `return` is unreachable',
  severity: 'error',
  confidence: 'high',
  file: 'app.py',
  start: { line: 2, column: 5 },
  end: { line: 2, column: 18 },
  snippet: 'print("dead")',
  evidence: ['preceding statement exits'],
  help: 'Delete it.',
};

const stats: ScanStats = {
  files: 1,
  byLanguage: { python: 1, javascript: 0, typescript: 0, tsx: 0, go: 0, rust: 0 },
  skipped: 0,
  parseErrors: 0,
  durationMs: 1,
};

test('contract: rule ids are the stable 1.0 set', () => {
  assert.deepEqual(ALL_RULE_METAS.map((meta) => meta.id).sort(), RULE_IDS);
});

test('contract: JSON output keeps the stable fields', () => {
  const payload = JSON.parse(
    renderJson({
      findings: [finding],
      stats,
      version: '1.0.0',
      suppressedByComment: 0,
      baselined: 0,
      hiddenByConfidence: 0,
    }),
  ) as Record<string, unknown> & { findings: Array<Record<string, unknown>> };
  assert.deepEqual(Object.keys(payload).sort(), [
    'findings',
    'stats',
    'summary',
    'tool',
    'version',
  ]);
  assert.deepEqual(Object.keys(payload.findings[0] ?? {}).sort(), [
    'confidence',
    'end',
    'evidence',
    'file',
    'fingerprint',
    'help',
    'message',
    'ruleId',
    'severity',
    'snippet',
    'start',
  ]);
});

test('contract: SARIF output keeps the stable shape', () => {
  const sarif = JSON.parse(renderSarif([finding], '1.0.0')) as {
    version: string;
    runs: Array<{
      tool: { driver: { name: string; version: string; rules: Array<{ id: string }> } };
      results: Array<Record<string, unknown>>;
    }>;
  };
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0]?.tool.driver.name, 'slopgate');
  assert.equal(sarif.runs[0]?.tool.driver.version, '1.0.0');
  assert.equal(sarif.runs[0]?.tool.driver.rules[0]?.id, 'py/unreachable');
  assert.ok(sarif.runs[0]?.results[0]?.locations);
});
