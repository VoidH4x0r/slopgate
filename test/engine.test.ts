import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { scanProject } from '../src/engine.ts';
import { FIXTURES, ROOT, scanFixture } from './helpers.ts';

test('scanProject strips a UTF-8 BOM before computing positions', async () => {
  const dir = await mkdtemp(path.join(ROOT, 'test', '.tmp-bom-src-'));
  try {
    await writeFile(path.join(dir, 'app.py'), '\uFEFFimport requests_v2\n\ndef f():\n    pass\n', 'utf8');
    const result = await scanProject({
      root: dir,
      config: { ...DEFAULT_CONFIG, include: ['**/*.py'], exclude: [] },
    });
    const phantom = result.findings.find((finding) => finding.ruleId === 'py/phantom-import');
    assert.ok(phantom, 'the import must still be reported');
    assert.equal(phantom.start.line, 1);
    assert.equal(phantom.start.column, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('scanProject finds the expected rule set in the demo fixture', async () => {
  const result = await scanFixture('demo');
  const ids = new Set(result.findings.map((finding) => finding.ruleId));
  assert.deepEqual(
    [...ids].sort(),
    [
      'py/dead-branch',
      'py/noop-test',
      'py/phantom-import',
      'py/stub-body',
      'py/swallowed-exception',
      'py/tautological-assert',
      'py/unreachable',
      'ts/dead-branch',
      'ts/noop-test',
      'ts/phantom-import',
      'ts/stub-function',
      'ts/swallowed-exception',
      'ts/tautological-assert',
      'ts/unreachable',
    ].sort(),
  );
  assert.equal(result.findings.length, 14);
  assert.equal(result.stats.files, 4);
  assert.equal(result.stats.byLanguage.python, 3);
  assert.equal(result.stats.byLanguage.typescript, 1);
  assert.equal(result.stats.byLanguage.javascript, 0);
  assert.equal(result.stats.byLanguage.tsx, 0);
  assert.deepEqual(result.warnings, []);
});

test('scanProject does not flag a repository that is actually clean', async () => {
  const result = await scanFixture('clean');
  assert.deepEqual(result.findings, []);
  assert.equal(result.stats.files, 2);
});

test('scanProject honours "off" in the rules config', async () => {
  const result = await scanFixture('demo', { rules: { 'py/noop-test': 'off' } });
  assert.ok(result.findings.every((finding) => finding.ruleId !== 'py/noop-test'));
});

test('scanProject honours a severity override', async () => {
  const result = await scanFixture('demo', { rules: { 'py/dead-branch': 'error' } });
  const branch = result.findings.find((finding) => finding.ruleId === 'py/dead-branch');
  assert.equal(branch?.severity, 'error');
});

test('scanProject honours onlyRules', async () => {
  const result = await scanFixture('demo', {}, ['py/phantom-import']);
  assert.ok(result.findings.length > 0);
  assert.ok(result.findings.every((finding) => finding.ruleId === 'py/phantom-import'));
});

test('scanProject applies suppression comments', async () => {
  const result = await scanFixture('suppressed');
  assert.equal(result.findings.length, 1);
  assert.equal(result.suppressedCount, 1);
});

test('scanProject warns about unknown rule ids in the config', async () => {
  const result = await scanFixture('demo', { rules: { 'py/does-not-exist': 'off' } });
  assert.ok(result.warnings.some((warning) => warning.includes('py/does-not-exist')));
});

test('scanProject accepts a single file and still resolves project manifests', async () => {
  const root = path.join(FIXTURES, 'demo', 'app.py');
  const result = await scanProject({ root, config: { ...DEFAULT_CONFIG, rules: {} } });
  assert.equal(result.stats.files, 1);
  assert.ok(result.findings.length > 0);
  assert.ok(result.findings.every((finding) => finding.file === 'app.py'));
  // `requests_v2` is declared in the fixture's pyproject.toml, so only `helper`
  // should be reported as a phantom import.
  const phantoms = result.findings.filter((finding) => finding.ruleId === 'py/phantom-import');
  assert.equal(phantoms.length, 1);
  assert.match(phantoms[0]?.message ?? '', /helper/);
});

test('scanProject sorts findings by file, line and rule', async () => {
  const result = await scanFixture('demo');
  const sorted = [...result.findings].sort(
    (a, b) => a.file.localeCompare(b.file) || a.start.line - b.start.line || a.ruleId.localeCompare(b.ruleId),
  );
  assert.deepEqual(result.findings, sorted);
});
