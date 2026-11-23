import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { scanProject } from '../src/engine.ts';

async function scan(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-requirements-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(dir, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }
    return await scanProject({
      root: dir,
      config: { ...DEFAULT_CONFIG, include: ['**/*.py'], exclude: [] },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('dev-requirements and setup.py extras are parsed', async () => {
  const result = await scan({
    'dev-requirements.txt': 'requests[socks]>=2\nclick\n',
    'setup.py': 'from setuptools import setup\nsetup(install_requires=["requests[socks]>=2.0", "click"])\n',
    'app.py': 'import requests\nimport click\n',
  });
  assert.deepEqual(
    result.findings.filter((finding) => finding.ruleId === 'py/phantom-import'),
    [],
  );
});

test('requirements subdirectories and -r includes are parsed', async () => {
  const result = await scan({
    'requirements/base.txt': 'requests>=2\n',
    'requirements/prod.txt': '-r base.txt\nuvicorn\n',
    'app.py': 'import requests\nimport uvicorn\n',
  });
  assert.deepEqual(
    result.findings.filter((finding) => finding.ruleId === 'py/phantom-import'),
    [],
  );
});

test('requirements-*.txt and PEP 508 direct references are parsed', async () => {
  const result = await scan({
    'requirements-api.txt': 'fastapi\nmypkg @ https://example.test/mypkg.whl\nother @ git+https://example.test/other.git\n',
    'app.py': 'import fastapi\nimport mypkg\nimport other\n',
  });
  assert.deepEqual(
    result.findings.filter((finding) => finding.ruleId === 'py/phantom-import'),
    [],
  );
});
