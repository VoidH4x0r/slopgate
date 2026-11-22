import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-ignore -- plain ESM helper, no declaration file
import { compareDurations } from '../scripts/benchmark-perf.mjs';

function result(corpora: Array<{ name: string; durationMs: number }>) {
  return { corpora };
}

test('benchmark performance guard accepts runs within the threshold', () => {
  const previous = result([
    { name: 'a', durationMs: 1000 },
    { name: 'b', durationMs: 500 },
  ]);
  const current = result([
    { name: 'a', durationMs: 1099 },
    { name: 'b', durationMs: 540 },
  ]);
  assert.deepEqual(compareDurations(previous, current, 10), []);
});

test('benchmark performance guard reports a run beyond the threshold', () => {
  const previous = result([{ name: 'a', durationMs: 1000 }]);
  const current = result([{ name: 'a', durationMs: 1101 }]);
  assert.deepEqual(compareDurations(previous, current, 10), [
    { name: 'a', previousMs: 1000, currentMs: 1101 },
  ]);
});

test('benchmark performance guard ignores short noisy corpora', () => {
  const previous = result([
    { name: 'tiny', durationMs: 35 },
    { name: 'medium', durationMs: 800 },
  ]);
  const current = result([
    { name: 'tiny', durationMs: 80 },
    { name: 'medium', durationMs: 1100 },
  ]);
  assert.deepEqual(compareDurations(previous, current, 5), []);
});

test('benchmark performance guard ignores new and missing corpora', () => {
  const previous = result([{ name: 'old', durationMs: 1000 }]);
  const current = result([
    { name: 'old', durationMs: 1050 },
    { name: 'new', durationMs: 5000 },
  ]);
  assert.deepEqual(compareDurations(previous, current, 10), []);
  assert.deepEqual(compareDurations(result([]), current, 10), []);
});
