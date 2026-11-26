import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { scanProject } from '../src/engine.ts';

async function withRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'slopgate-scope-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, text, 'utf8');
  }
  return root;
}

test('a dependency declared by a sibling project is reported at medium confidence', async () => {
  const root = await withRepo({
    'packages/api/requirements.txt': 'requests==2.32.0\n',
    'packages/api/app.py': 'import requests\n',
    'packages/worker/worker.py': 'import requests\n',
  });
  try {
    const scan = await scanProject({ root, config: { ...DEFAULT_CONFIG, rules: {} } });
    const worker = scan.findings.find((finding) => finding.ruleId === 'py/phantom-import' && finding.file.includes('worker'));
    assert.ok(worker, 'expected a phantom-import report for the worker package');
    assert.equal(worker.confidence, 'medium');
    assert.match(worker.message, /another project in the repository/);
    assert.ok(!scan.findings.some((finding) => finding.ruleId === 'py/phantom-import' && finding.file.includes('api/app.py')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a Python dependency nobody declares stays high', async () => {
  const root = await withRepo({
    'packages/api/requirements.txt': 'requests==2.32.0\n',
    'packages/worker/worker.py': 'import invented_package_xyz\n',
  });
  try {
    const scan = await scanProject({ root, config: { ...DEFAULT_CONFIG, rules: {} } });
    const finding = scan.findings.find((item) => item.ruleId === 'py/phantom-import');
    assert.ok(finding);
    assert.equal(finding.confidence, 'high');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a node dependency declared by a sibling package is reported at medium confidence', async () => {
  const root = await withRepo({
    'packages/web/package.json': JSON.stringify({ name: 'web', version: '1.0.0', dependencies: { 'left-pad': '1.3.0' } }),
    'packages/tool/package.json': JSON.stringify({ name: 'tool', version: '1.0.0', dependencies: {} }),
    'packages/tool/index.ts': "import leftPad from 'left-pad';\nleftPad('x', 5);\n",
  });
  try {
    const scan = await scanProject({ root, config: { ...DEFAULT_CONFIG, rules: {} } });
    const finding = scan.findings.find((item) => item.ruleId === 'ts/phantom-import');
    assert.ok(finding, 'expected a phantom-import report');
    assert.equal(finding.confidence, 'medium');
    assert.match(finding.message, /another package in the workspace/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
