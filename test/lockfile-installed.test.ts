import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { loadProjectDeps, nodeLockNames, pythonLockNames } from '../src/deps.ts';
import { scanProject } from '../src/engine.ts';

async function withRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'slopgate-lock-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, text, 'utf8');
  }
  return root;
}

test('pythonLockNames reads uv.lock, poetry.lock and Pipfile.lock', () => {
  const uv = ['version = 1', '[[package]]', 'name = "requests"', 'version = "2.32.0"', '', '[[package]]', 'name = "urllib3"'].join('\n');
  assert.deepEqual(pythonLockNames('uv.lock', uv).sort(), ['requests', 'urllib3']);
  const poetry = ['[[package]]', 'name = "PyYAML"', 'version = "6.0"'].join('\n');
  assert.deepEqual(pythonLockNames('poetry.lock', poetry), ['pyyaml']);
  const pipfile = JSON.stringify({ default: { requests: { version: '==2.32.0' } }, develop: {} });
  assert.deepEqual(pythonLockNames('Pipfile.lock', pipfile), ['requests']);
});

test('nodeLockNames reads package-lock.json and pnpm-lock.yaml', () => {
  const lock = JSON.stringify({ packages: { '': {}, 'node_modules/left-pad': { version: '1.3.0' }, 'node_modules/@scope/pkg': { version: '2.0.0' } } });
  assert.deepEqual(nodeLockNames('package-lock.json', lock).sort(), ['@scope/pkg', 'left-pad']);
  const pnpm = ['lockfileVersion: 9', 'packages:', '', "  '@scope/pkg@2.0.0':", '    resolution: {}', '  left-pad@1.3.0:', '    resolution: {}'].join('\n');
  assert.deepEqual(nodeLockNames('pnpm-lock.yaml', pnpm).sort(), ['@scope/pkg', 'left-pad']);
});

test('loadProjectDeps reports lockfile-pinned python distributions as installed', async () => {
  const root = await withRepo({
    'pyproject.toml': ['[project]', 'name = "demo"', 'dependencies = ["requests"]'].join('\n'),
    'uv.lock': ['[[package]]', 'name = "numpy"'].join('\n'),
  });
  try {
    const deps = await loadProjectDeps(root);
    assert.ok(deps.python.declared.has('requests'));
    assert.ok(deps.python.installed.has('numpy'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a lockfile-pinned python import is reported at medium confidence', async () => {
  const root = await withRepo({
    'pyproject.toml': ['[project]', 'name = "demo"', 'dependencies = []'].join('\n'),
    'uv.lock': ['[[package]]', 'name = "numpy"'].join('\n'),
    'app.py': 'import numpy\n',
  });
  try {
    const scan = await scanProject({ root, config: { ...DEFAULT_CONFIG, rules: {} } });
    const finding = scan.findings.find((f) => f.ruleId === 'py/phantom-import');
    assert.ok(finding, 'expected a phantom-import report');
    assert.equal(finding.confidence, 'medium');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an undeclared python import with no lockfile stays high', async () => {
  const root = await withRepo({
    'pyproject.toml': ['[project]', 'name = "demo"', 'dependencies = []'].join('\n'),
    'app.py': 'import numpy\n',
  });
  try {
    const scan = await scanProject({ root, config: { ...DEFAULT_CONFIG, rules: {} } });
    const finding = scan.findings.find((f) => f.ruleId === 'py/phantom-import');
    assert.ok(finding, 'expected a phantom-import report');
    assert.equal(finding.confidence, 'high');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a lockfile-pinned node import is reported at medium confidence', async () => {
  const root = await withRepo({
    'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: {} }),
    'package-lock.json': JSON.stringify({ packages: { '': {}, 'node_modules/left-pad': { version: '1.3.0' } } }),
    'index.ts': "import leftPad from 'left-pad';\nleftPad('x', 5);\n",
  });
  try {
    const scan = await scanProject({ root, config: { ...DEFAULT_CONFIG, rules: {} } });
    const finding = scan.findings.find((f) => f.ruleId === 'ts/phantom-import');
    assert.ok(finding, 'expected a phantom-import report');
    assert.equal(finding.confidence, 'medium');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
