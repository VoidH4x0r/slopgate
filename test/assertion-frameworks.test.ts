import assert from 'node:assert/strict';
import test from 'node:test';
import { runRule } from './helpers.ts';

const ASSERTIONS: Array<[framework: string, callee: string]> = [
  ['tape equality', 't.equal(1, 1)'],
  ['tape deep equality', 't.deepEqual({ a: 1 }, { a: 1 })'],
  ['tape inequality', 't.notEqual(1, 2)'],
  ['tape strict equality', 't.strictEqual(1, 1)'],
  ['tape doesNotThrow', 't.doesNotThrow(() => {})'],
  ['tape notMatch', "t.notMatch('a', 'b')"],
  ['tape error', 't.error(null)'],
  ['tape notOk', 't.notOk(false)'],
  ['node:test ok', 't.ok(true)'],
  ['node:test is', 't.is(1, 1)'],
  ['node:test assert namespace', 't.assert.strictEqual(1, 1)'],
  ['jest toBe', 'expect(1).toBe(1)'],
  ['jest not.toEqual', 'expect({ a: 1 }).not.toEqual({ b: 2 })'],
  ['chai assert', 'chai.assert.equal(1, 1)'],
  ['should', 'should.equal(1, 1)'],
  ['node assert strictEqual', 'assert.strictEqual(1, 1)'],
  ['node assert deepEqual', 'assert.deepEqual({ a: 1 }, { a: 1 })'],
];

for (const [framework, callee] of ASSERTIONS) {
  test(`ts/noop-test accepts ${framework}`, async () => {
    const source = `test('framework assertion', () => { ${callee}; });\n`;
    assert.deepEqual(await runRule('ts/noop-test', source, 'typescript'), []);
  });
}
