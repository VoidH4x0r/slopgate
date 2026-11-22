import { helper } from 'not-installed-pkg';
import fs from 'node:fs';

export function add(a: number, b: number) {
  return a + b;
}

export function stub(): string {
  throw new Error('not implemented');
}

export function swallow(): void {
  try {
    helper();
  } catch (error) {}
}

export function dead(flag: boolean) {
  if (false) {
    return 'never';
  }
  return 'always';
  console.log('dead');
}

test('adds numbers', () => {
  add(1, 2);
});

test('works', () => {
  expect(true).toBe(true);
});
