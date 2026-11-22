import assert from 'node:assert/strict';
import test from 'node:test';
import { isSuppressed, readSuppressions } from '../src/suppress.ts';
import type { Finding } from '../src/types.ts';

function finding(line: number, ruleId: string): Finding {
  return {
    ruleId,
    message: 'x',
    severity: 'warning',
    confidence: 'high',
    file: 'a.py',
    start: { line, column: 1 },
    end: { line, column: 1 },
    snippet: '',
    evidence: [],
  };
}

test('readSuppressions understands next-line, same-line and file directives', () => {
  const source = [
    '# slopgate-ignore-next-line py/noop-test',
    'def test_a(): pass',
    'x = 1  # slopgate-ignore-line',
    'y = 2  # slopgate-ignore-line ts/stub-function',
  ].join('\n');
  const suppressions = readSuppressions(source);
  assert.equal(suppressions.fileDisabled, false);
  assert.deepEqual(suppressions.lineRules.get(2), new Set(['py/noop-test']));
  assert.equal(suppressions.lineRules.get(3), 'all');
  assert.deepEqual(suppressions.lineRules.get(4), new Set(['ts/stub-function']));
});

test('readSuppressions supports slopgate-disable-file', () => {
  const suppressions = readSuppressions('# slopgate-disable-file\ndef f(): pass\n');
  assert.equal(suppressions.fileDisabled, true);
});

test('isSuppressed respects rule-specific directives', () => {
  const source = '# slopgate-ignore-next-line py/noop-test\ndef test_a(): pass\n';
  const suppressions = readSuppressions(source);
  assert.equal(isSuppressed(finding(2, 'py/noop-test'), suppressions), true);
  assert.equal(isSuppressed(finding(2, 'py/stub-body'), suppressions), false);
  assert.equal(isSuppressed(finding(3, 'py/stub-body'), suppressions), false);
});

test('isSuppressed returns false without directives', () => {
  assert.equal(isSuppressed(finding(1, 'py/noop-test'), readSuppressions('x = 1\n')), false);
});
