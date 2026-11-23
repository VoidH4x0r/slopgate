#!/usr/bin/env node
/** Release checklist: package version, changelog entry and benchmark versions agree. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const errors = [];

if (!changelog.includes(`## [${version}]`)) {
  errors.push(`CHANGELOG.md has no ## [${version}] section`);
}

for (const file of [
  'benchmark/results.json',
  'benchmark/go-results.json',
  'benchmark/rust-results.json',
  'benchmark/tape-results.json',
  'benchmark/heldout-results.json',
  'benchmark/bundled-results.json',
]) {
  if (!existsSync(path.join(ROOT, file))) {
    errors.push(`${file}: missing`);
    continue;
  }
  const report = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
  if (report.slopgateVersion !== version) {
    errors.push(`${file}: benchmark version ${report.slopgateVersion} != ${version}`);
  }
}

const extensionPath = path.join(ROOT, 'packages', 'slopgate-vscode', 'package.json');
if (!existsSync(extensionPath)) errors.push('packages/slopgate-vscode/package.json: missing');

if (errors.length > 0) {
  console.error('release check failed:');
  for (const error of errors) console.error(`  ${error}`);
  process.exitCode = 1;
} else {
  console.log(`release check OK: ${version}`);
}
