import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'benchmark', 'ai-pr');

const manifest = JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as {
  prs: Array<{
    repo: string;
    number: number;
    sha: string;
    license: string;
    files: Array<{ path: string; sha256: string; lines: number }>;
    lines: number;
  }>;
  totals: { files: number; lines: number; prs: number };
  asset: { name: string; url: string; sha256: string };
};
const labels = JSON.parse(readFileSync(path.join(DIR, 'labels.json'), 'utf8')) as Record<string, { label: string; note: string }>;
const results = JSON.parse(readFileSync(path.join(DIR, 'results.json'), 'utf8')) as {
  high: number;
  findings: Array<{ fingerprint: string }>;
  labeled: { tp: number; fp: number };
  unlabeledHigh: string[];
  staleLabels: string[];
  verifyFailures: number;
  corpus: { prs: number };
};
const labelEntries = Object.entries(labels) as Array<[string, { label: string; note: string }]>;

const PERMISSIVE = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense', 'CC0-1.0', 'MIT-0', 'Zlib', 'BSL-1.0']);

test('the AI PR corpus manifest is internally consistent', () => {
  assert.equal(manifest.prs.length, 150);
  const keys = new Set();
  let files = 0;
  let lines = 0;
  for (const pr of manifest.prs) {
    const key = `${pr.repo}#${pr.number}`;
    assert.ok(!keys.has(key), `duplicate corpus entry ${key}`);
    keys.add(key);
    assert.match(pr.sha, /^[0-9a-f]{40}$/);
    assert.ok(PERMISSIVE.has(pr.license), `unexpected license ${pr.license} for ${key}`);
    assert.ok(pr.files.length > 0, `${key} has no changed files`);
    for (const file of pr.files) {
      assert.ok(!path.isAbsolute(file.path) && !file.path.split('/').includes('..'), `unsafe path ${file.path}`);
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
      assert.ok(file.lines > 0);
    }
    files += pr.files.length;
    lines += pr.lines;
  }
  assert.equal(files, manifest.totals.files);
  assert.equal(lines, manifest.totals.lines);
  assert.match(manifest.asset.sha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.asset.url, /^https:\/\/github\.com\/.+\/releases\/download\//);
});

test('every AI PR corpus label is well formed', () => {
  const entries = labelEntries;
  assert.ok(entries.length > 0);
  for (const [fingerprint, label] of entries) {
    assert.match(fingerprint, /^[0-9a-f]{16}$/);
    assert.ok(label.label === 'tp' || label.label === 'fp');
    assert.equal(typeof label.note, 'string');
    assert.ok(label.note.length > 0);
  }
});

test('the committed AI PR benchmark result matches its labels', () => {
  const tp = results.findings.filter((finding) => labels[finding.fingerprint]?.label === 'tp').length;
  const fp = results.findings.filter((finding) => labels[finding.fingerprint]?.label === 'fp').length;
  assert.equal(results.high, results.findings.length);
  assert.equal(results.labeled.tp, tp);
  assert.equal(results.labeled.fp, fp);
  assert.equal(results.unlabeledHigh.length, 0);
  assert.equal(results.staleLabels.length, 0);
  assert.equal(results.verifyFailures, 0);
  assert.equal(results.corpus.prs, manifest.totals.prs);
});
