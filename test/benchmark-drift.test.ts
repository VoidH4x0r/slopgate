import assert from 'node:assert/strict';
import test from 'node:test';

const { compareResults } = await import(new URL('../scripts/check-benchmark-drift.mjs', import.meta.url).href);

type Json = Record<string, any>;

function report(overrides: Json = {}): Json {
  return {
    staleLabels: [],
    unlabeledHigh: [],
    recall: { total: 30, detected: 30 },
    corpora: [
      {
        name: 'cpython-stdlib',
        digest: '0123456789abcdef',
        files: 1845,
        high: 29,
        durationMs: 12000,
        parseErrors: 0,
        precision: { overall: { tp: 28, fp: 1, precision: 28 / 29 } },
      },
    ],
    ...overrides,
  };
}

function withCorpus(patch: Json): Json {
  const base = report();
  const corpus = { ...base.corpora[0], ...patch };
  return { ...base, corpora: [corpus] };
}

test('identical reports have no drift', () => {
  assert.deepEqual(compareResults(report(), report()), []);
});

test('a changed high-confidence count is drift', () => {
  const problems = compareResults(withCorpus({ high: 30 }), report());
  assert.match(problems.join('\n'), /high-confidence count changed/);
});

test('a changed corpus digest is drift', () => {
  const problems = compareResults(withCorpus({ digest: 'fedcba9876543210' }), report());
  assert.match(problems.join('\n'), /corpus digest changed/);
});

test('a missing corpus is drift', () => {
  const current = report();
  current.corpora = [];
  const problems = compareResults(current, report());
  assert.match(problems.join('\n'), /corpus missing from the new run/);
});

test('a stale label fails the run', () => {
  const problems = compareResults(report({ staleLabels: ['fingerprint'] }), report());
  assert.match(problems.join('\n'), /stale label/);
});

test('an unlabeled high finding fails the run', () => {
  const problems = compareResults(report({ unlabeledHigh: ['fingerprint'] }), report());
  assert.match(problems.join('\n'), /without a label/);
});

test('a seeded recall drop fails the run', () => {
  const current = report({ recall: { total: 30, detected: 29 } });
  const problems = compareResults(current, report());
  assert.match(problems.join('\n'), /seeded recall changed/);
});

test('the CPython duration budget is enforced', () => {
  const problems = compareResults(withCorpus({ durationMs: 21000 }), report(), { maxDurationMs: 20000 });
  assert.match(problems.join('\n'), /exceeds the 20000ms budget/);
});

test('parse errors may drift within the tolerance but not beyond it', () => {
  const baseline = withCorpus({ parseErrors: 72 });
  const within = compareResults(withCorpus({ parseErrors: 75 }), baseline);
  assert.deepEqual(within, []);
  const beyond = compareResults(withCorpus({ parseErrors: 80 }), baseline);
  assert.match(beyond.join('\n'), /parse errors drifted/);
});
