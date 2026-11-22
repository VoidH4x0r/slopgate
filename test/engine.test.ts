import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

test('scanProject rejects unknown rule ids in the config', async () => {
  await assert.rejects(
    () => scanFixture('demo', { rules: { 'py/does-not-exist': 'off' } }),
    /py\/does-not-exist/,
  );
});

test('config include replaces the default pattern set', async () => {
  const root = path.join(FIXTURES, 'regressions', 'include-semantics');
  const defaults = await scanProject({ root, config: { ...DEFAULT_CONFIG, rules: {} } });
  assert.equal(defaults.stats.files, 3);
  assert.ok(defaults.findings.some((finding) => finding.file === 'app.py'));

  const replaced = await scanProject({
    root,
    config: { ...DEFAULT_CONFIG, include: ['src/**'], rules: {} },
  });
  assert.equal(replaced.stats.files, 2);
  assert.ok(!replaced.findings.some((finding) => finding.file === 'app.py'));
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

test('non-git package scans see ancestor manifests through lookupRoot', async () => {
  const dir = await mkdtemp(path.join(ROOT, 'test', '.tmp-nongit-lookup-'));
  try {
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await writeFile(
      path.join(dir, 'pyproject.toml'),
      '[project]\nname = "root"\nversion = "0.0.0"\ndependencies = ["requests"]\n',
    );
    await writeFile(path.join(dir, 'assets', 'package.json'), '{"name":"assets","private":true}\n');
    await writeFile(path.join(dir, 'assets', 'build.py'), 'import requests\n');

    const result = await scanProject({
      root: path.join(dir, 'assets'),
      projectRoot: path.join(dir, 'assets'),
      indexRoot: path.join(dir, 'assets'),
      lookupRoot: dir,
      reportRoot: dir,
      config: { ...DEFAULT_CONFIG, rules: {} },
    });
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === 'py/phantom-import'),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('non-git package scans see namespace packages through lookupRoot', async () => {
  const dir = await mkdtemp(path.join(ROOT, 'test', '.tmp-nongit-namespace-'));
  try {
    await mkdir(path.join(dir, 'lib', 'sub'), { recursive: true });
    await mkdir(path.join(dir, 'packages', 'app'), { recursive: true });
    await writeFile(path.join(dir, 'lib', 'sub', 'module.py'), 'def f():\n    return 1\n');
    await writeFile(
      path.join(dir, 'packages', 'app', 'pyproject.toml'),
      '[project]\nname = "app"\nversion = "0.0.0"\ndependencies = []\n',
    );
    await writeFile(
      path.join(dir, 'packages', 'app', 'app.py'),
      'from lib.sub.module import f\n',
    );

    const result = await scanProject({
      root: path.join(dir, 'packages', 'app'),
      projectRoot: path.join(dir, 'packages', 'app'),
      indexRoot: path.join(dir, 'packages', 'app'),
      lookupRoot: dir,
      reportRoot: dir,
      config: { ...DEFAULT_CONFIG, rules: {} },
    });
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === 'py/phantom-import'),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('non-git ancestor indexing does not treat non-Python workspace names as modules', async () => {
  const dir = await mkdtemp(path.join(ROOT, 'test', '.tmp-nongit-nonpython-'));
  try {
    await mkdir(path.join(dir, 'scripts'), { recursive: true });
    await mkdir(path.join(dir, 'packages', 'app'), { recursive: true });
    await writeFile(path.join(dir, 'scripts', 'run.sh'), '#!/bin/sh\n');
    await writeFile(
      path.join(dir, 'packages', 'app', 'pyproject.toml'),
      '[project]\nname = "app"\nversion = "0.0.0"\ndependencies = []\n',
    );
    await writeFile(path.join(dir, 'packages', 'app', 'app.py'), 'import scripts\n');

    const result = await scanProject({
      root: path.join(dir, 'packages', 'app'),
      projectRoot: path.join(dir, 'packages', 'app'),
      indexRoot: path.join(dir, 'packages', 'app'),
      lookupRoot: dir,
      reportRoot: dir,
      config: { ...DEFAULT_CONFIG, rules: {} },
    });
    assert.equal(
      result.findings.filter((finding) => finding.ruleId === 'py/phantom-import').length,
      1,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('non-git package scans see sibling local modules through lookupRoot', async () => {
  const dir = await mkdtemp(path.join(ROOT, 'test', '.tmp-nongit-sibling-'));
  try {
    await mkdir(path.join(dir, 'lib'), { recursive: true });
    await mkdir(path.join(dir, 'packages', 'app'), { recursive: true });
    await writeFile(path.join(dir, 'lib', 'util.py'), 'def f():\n    return 1\n');
    await writeFile(
      path.join(dir, 'packages', 'app', 'pyproject.toml'),
      '[project]\nname = "app"\nversion = "0.0.0"\ndependencies = []\n',
    );
    await writeFile(path.join(dir, 'packages', 'app', 'app.py'), 'from lib.util import f\n');

    const result = await scanProject({
      root: path.join(dir, 'packages', 'app'),
      projectRoot: path.join(dir, 'packages', 'app'),
      indexRoot: path.join(dir, 'packages', 'app'),
      lookupRoot: dir,
      reportRoot: dir,
      config: { ...DEFAULT_CONFIG, rules: {} },
    });
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === 'py/phantom-import'),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
