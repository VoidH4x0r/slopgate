import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  loadProjectDeps,
  normalizePythonName,
  parsePythonManifestText,
  requirementName,
  resolveProjectRoot,
} from '../src/deps.ts';
import { loadProjectRegistry } from '../src/projects.ts';
import { FIXTURES } from './helpers.ts';

test('normalizePythonName applies PEP 503 rules', () => {
  assert.equal(normalizePythonName('Requests'), 'requests');
  assert.equal(normalizePythonName('python_dateutil'), 'python-dateutil');
  assert.equal(normalizePythonName('zope.interface'), 'zope-interface');
});

test('requirementName extracts the distribution name', () => {
  assert.equal(requirementName('requests>=2.31'), 'requests');
  assert.equal(requirementName('requests[socks]>=2.0 ; python_version > "3.8"'), 'requests');
  assert.equal(requirementName('  PyYAML == 6.0  '), 'pyyaml');
  assert.equal(requirementName('-e .'), undefined);
  assert.equal(requirementName('git+https://example.com/x.git'), undefined);
  assert.equal(requirementName('# just a comment'), undefined);
  assert.equal(requirementName(''), undefined);
});

test('parsePythonManifestText reads requirements.txt', () => {
  const names = parsePythonManifestText(
    'requirements.txt',
    ['# deps', 'requests>=2', 'flask[async]  # web', '-r other.txt', 'uvicorn'].join('\n'),
  );
  assert.deepEqual(names.sort(), ['flask', 'requests', 'uvicorn']);
});

test('parsePythonManifestText reads requirements.in and environment.yml', () => {
  assert.deepEqual(
    parsePythonManifestText('requirements.in', 'django>=5\ncelery\n').sort(),
    ['celery', 'django'],
  );
  const environment = [
    'name: app',
    'dependencies:',
    '  - python=3.12',
    '  - numpy>=2',
    '  - pip:',
    '      - requests==2.32',
    '      - uvicorn[standard]',
    '  - pip',
  ].join('\n');
  assert.deepEqual(
    parsePythonManifestText('environment.yml', environment).sort(),
    ['numpy', 'requests', 'uvicorn'],
  );
});

test('parsePythonManifestText reads pyproject project.dependencies and poetry', () => {
  const pyproject = [
    '[project]',
    'name = "x"',
    'dependencies = [',
    '  "requests>=2.0",',
    '  "pydantic[email]",',
    ']',
    '',
    '[tool.poetry.dependencies]',
    'python = "^3.11"',
    'httpx = "^0.27"',
    '',
    '[build-system]',
    'requires = ["hatchling"]',
  ].join('\n');
  const names = parsePythonManifestText('pyproject.toml', pyproject);
  assert.ok(names.includes('requests'));
  assert.ok(names.includes('pydantic'));
  assert.ok(names.includes('httpx'));
  assert.ok(names.includes('hatchling'));
  assert.ok(!names.includes('python'));
});

test('parsePythonManifestText reads extras, dependency-groups and every poetry group', () => {
  const pyproject = [
    '[project]',
    'name = "x"',
    'dependencies = [',
    '  "requests>=2 ; python_version < \'3.12\'",',
    ']',
    '',
    '[project.optional-dependencies]',
    'cli = ["click"]',
    'docs = ["sphinx"]',
    '',
    '[dependency-groups]',
    'dev = ["moto", {include-group = "lint"}]',
    'lint = ["ruff"]',
    '',
    '[tool.poetry.group.test.dependencies]',
    'pytest = "^8.0"',
    '',
    '[tool.poetry.group.docs.dependencies]',
    'mkdocs = "^1.6"',
    '',
    '[tool.uv]',
    'dev-dependencies = ["pytest-cov"]',
    '',
    '[build-system]',
    'requires = ["hatchling"]',
  ].join('\n');
  const names = parsePythonManifestText('pyproject.toml', pyproject);
  for (const expected of [
    'requests',
    'click',
    'sphinx',
    'moto',
    'ruff',
    'pytest',
    'mkdocs',
    'pytest-cov',
    'hatchling',
  ]) {
    assert.ok(names.includes(expected), `expected ${expected} in ${names.join(', ')}`);
  }
  assert.ok(!names.includes('python'));
  assert.ok(!names.includes('3-12'), 'environment markers must not become package names');
});

test('parsePythonManifestText resolves include-group cycles without hanging', () => {
  const pyproject = [
    '[dependency-groups]',
    'a = ["one", {include-group = "b"}]',
    'b = ["two", {include-group = "a"}]',
  ].join('\n');
  const names = parsePythonManifestText('pyproject.toml', pyproject).sort();
  assert.deepEqual(names, ['one', 'two']);
});

test('parsePythonManifestText reads setup.py and Pipfile', () => {
  const setup = ['setup(', '  install_requires=["requests>=2", "click"],', ')'].join('\n');
  assert.deepEqual(parsePythonManifestText('setup.py', setup).sort(), ['click', 'requests']);

  const pipfile = ['[packages]', 'requests = "*"', 'flask = { version = "2.0" }'].join('\n');
  assert.deepEqual(parsePythonManifestText('Pipfile', pipfile).sort(), ['flask', 'requests']);
});

test('loadProjectDeps reads the demo fixture', async () => {
  const deps = await loadProjectDeps(path.join(FIXTURES, 'demo'));
  assert.ok(deps.python.declared.has('requests-v2'));
  assert.deepEqual(deps.python.manifests, ['pyproject.toml']);
  assert.ok(deps.node.declared.has('left-pad'));
  assert.equal(deps.node.hasPackageJson, true);
});

test('loadProjectDeps expands a tsconfig baseUrl into import aliases', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-baseurl-'));
  try {
    await mkdir(path.join(dir, 'src', 'components'), { recursive: true });
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      '{"compilerOptions":{"baseUrl":"./src"}}\n',
    );
    await writeFile(
      path.join(dir, 'src', 'components', 'button.ts'),
      'export const button = 1;\n',
    );
    const deps = await loadProjectDeps(dir);
    assert.ok(deps.node.aliases.includes('components'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveProjectRoot walks to the boundary without git', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-nongit-root-'));
  try {
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "x"\nversion = "0"\n');
    assert.equal(await resolveProjectRoot(path.join(dir, 'src'), dir), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a type-only nested package.json does not hide the parent project', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-type-only-'));
  try {
    await mkdir(path.join(dir, 'helpers'), { recursive: true });
    await writeFile(
      path.join(dir, 'package.json'),
      '{"name":"root","dependencies":{"yargs-parser":"^22"}}\n',
    );
    await writeFile(path.join(dir, 'helpers', 'package.json'), '{"type":"commonjs"}\n');
    await writeFile(path.join(dir, 'helpers', 'app.ts'), "import Parser from 'yargs-parser';\n");
    const registry = await loadProjectRegistry({ scopeRoot: dir, fallbackRoot: dir });
    const deps = await registry.depsFor(path.join(dir, 'helpers', 'app.ts'), 'typescript');
    assert.equal(deps.root, dir);
    assert.ok(deps.node.declared.has('yargs-parser'));
    assert.ok(![...registry.projectDirs].some((key) => key.endsWith('helpers')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
