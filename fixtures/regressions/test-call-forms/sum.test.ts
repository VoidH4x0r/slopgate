import { describe, it, test } from 'node:test';

describe('suite', () => {
  it('inner test without assertion', () => {
    run();
  });
});

test.each([
  [1, 2],
  [3, 4],
])('table case %i + %i', (a, b) => {
  add(a, b);
});

it.concurrent('concurrent without assertion', async () => {
  await run();
});

test('has a real assertion', () => {
  expect(add(1, 2)).toBe(3);
});

declare function run(): void;
declare function add(a: number, b: number): number;
declare function expect(v: unknown): { toBe(x: unknown): void };
