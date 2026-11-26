#!/usr/bin/env node
/** Fail when the checked-in benchmark results are stale or the budget is exceeded. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const maxCpythonMs = Number(process.env.SLOPGATE_MAX_CPYTHON_MS ?? 25000);
const files = [
  'benchmark/results.json',
  'benchmark/go-results.json',
  'benchmark/rust-results.json',
  'benchmark/tape-results.json',
  'benchmark/heldout-results.json',
  'benchmark/bundled-results.json',
];
const errors = [];
let cpythonMs = 0;

for (const file of files) {
  const abs = path.join(ROOT, file);
  if (!existsSync(abs)) {
    errors.push(`${file}: missing`);
    continue;
  }
  const report = JSON.parse(readFileSync(abs, 'utf8'));
  if (report.slopgateVersion !== packageJson.version) {
    errors.push(`${file}: version ${report.slopgateVersion} != package ${packageJson.version}`);
  }
  if (report.staleLabels.length > 0) errors.push(`${file}: ${report.staleLabels.length} stale label(s)`);
  if (report.unlabeledHigh.length > 0) errors.push(`${file}: ${report.unlabeledHigh.length} unlabeled high finding(s)`);
  for (const corpus of report.corpora) {
    if (corpus.name === 'cpython-stdlib') cpythonMs = corpus.durationMs;
  }
}

if (cpythonMs > maxCpythonMs) {
  errors.push(`CPython scan ${cpythonMs}ms exceeds budget ${maxCpythonMs}ms`);
}

if (errors.length > 0) {
  console.error('performance/benchmark check failed:');
  for (const error of errors) console.error(`  ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `performance/benchmark OK: version ${packageJson.version}, CPython ${cpythonMs}ms (budget ${maxCpythonMs}ms), labels reconciled`,
  );
}
