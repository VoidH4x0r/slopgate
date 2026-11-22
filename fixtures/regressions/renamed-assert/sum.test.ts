import * as nodeAssert from 'node:assert';
import strictAssert from 'node:assert/strict';
import { test } from 'node:test';

test('namespace-qualified import', () => {
  nodeAssert.strictEqual(1 + 1, 2);
});

test('default import of node:assert/strict', () => {
  strictAssert.equal(1 + 1, 2);
});
