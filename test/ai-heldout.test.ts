import assert from 'node:assert/strict';
import test from 'node:test';
import { scanFixture } from './helpers.ts';

test('held-out AI corpus reports its eight labeled high findings', async () => {
  const result = await scanFixture('ai-heldout');
  const high = result.findings.filter((finding) => finding.confidence === 'high');
  assert.equal(high.length, 8);
  assert.deepEqual(
    high.map((finding) => finding.ruleId).sort(),
    [
      'py/noop-test',
      'py/phantom-import',
      'py/stub-body',
      'py/swallowed-exception',
      'py/unreachable',
      'ts/noop-test',
      'ts/phantom-import',
      'ts/stub-function',
    ],
  );
});
