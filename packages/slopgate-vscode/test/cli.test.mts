import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildScanArgs,
  isFixableRule,
  parseScanPayload,
  toDiagnostic,
} from '../dist/cli.js';

const payload = {
  tool: 'slopgate',
  reportRoot: '/repo',
  findings: [
    {
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
    },
  ],
};

test('parseScanPayload accepts the CLI JSON envelope', () => {
  const parsed = parseScanPayload(JSON.stringify(payload));
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0]?.ruleId, 'py/unreachable');
  assert.equal(parsed.reportRoot, '/repo');
});

test('parseScanPayload rejects an empty or non-JSON payload', () => {
  assert.throws(() => parseScanPayload(''), /no JSON/);
  assert.throws(() => parseScanPayload('not json'), /JSON object/);
});

test('toDiagnostic converts 1-based CLI positions to editor ranges', () => {
  const diagnostic = toDiagnostic(payload.findings[0]!);
  assert.deepEqual(
    [diagnostic.line, diagnostic.column, diagnostic.endLine, diagnostic.endColumn],
    [2, 5, 2, 18],
  );
  assert.equal(diagnostic.severity, 'error');
  assert.match(diagnostic.message, /py\/unreachable/);
  assert.match(diagnostic.message, /Delete it/);
});

test('buildScanArgs asks for JSON and disables color', () => {
  assert.deepEqual(
    buildScanArgs('src', { confidence: 'medium', failOn: 'none' }),
    ['src', '--format', 'json', '--confidence', 'medium', '--fail-on', 'none', '--no-color'],
  );
  assert.ok(buildScanArgs('src', { confidence: 'high', failOn: 'none' }, 'fix').includes('--fix'));
});

test('only the safe autofix rules are offered as quick fixes', () => {
  assert.equal(isFixableRule('py/unreachable'), true);
  assert.equal(isFixableRule('ts/unreachable'), true);
  assert.equal(isFixableRule('go/unreachable'), false);
  assert.equal(isFixableRule('rs/stub-body'), false);
});
