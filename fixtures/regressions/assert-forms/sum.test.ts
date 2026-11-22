import { deepStrictEqual, strictEqual } from 'node:assert';
import { test } from 'node:test';

const assert = require('node:assert');

test('named imports', () => {
  strictEqual(1 + 1, 2);
});

test('named structural', () => {
  deepStrictEqual({ a: 1 }, { a: 1 });
});

test('require binding', () => {
  assert.ok(true);
});

declare function require(id: string): any;
