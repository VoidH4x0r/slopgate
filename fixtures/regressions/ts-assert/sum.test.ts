import assert from 'node:assert/strict';
import { test } from 'node:test';

test('strictEqual asserts', () => {
  assert.strictEqual(1 + 1, 2);
});

test('ok asserts', () => {
  assert.ok(1 + 1 === 2);
});

test('deepStrictEqual asserts', () => {
  assert.deepStrictEqual({ a: 1 }, { a: 1 });
});

test('notEqual asserts', () => {
  assert.notEqual(1, 2);
});

test('match asserts', () => {
  assert.match('hello', /ell/);
});
