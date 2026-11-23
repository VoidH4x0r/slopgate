import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { scanProject } from '../src/engine.ts';

test('malformed tsconfig types do not abort scanning', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-tsconfig-bad-'));
  try {
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ extends: 42, references: [null] }),
      'utf8',
    );
    await writeFile(path.join(dir, 'package.json'), '{"name":"bad","version":"0.0.0"}\n', 'utf8');
    await writeFile(path.join(dir, 'app.ts'), "import leftPad from 'left-pad';\nvoid leftPad;\n", 'utf8');
    const result = await scanProject({
      root: dir,
      config: { ...DEFAULT_CONFIG, include: ['**/*.ts'], exclude: [] },
    });
    assert.equal(
      result.findings.filter((finding) => finding.ruleId === 'ts/phantom-import').length,
      1,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tsconfig exact paths keys are not treated as prefixes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-tsconfig-exact-'));
  try {
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@config': ['src/config.ts'] } } }),
      'utf8',
    );
    await writeFile(path.join(dir, 'package.json'), '{"name":"exact","version":"0.0.0"}\n', 'utf8');
    await writeFile(path.join(dir, 'src', 'config.ts'), 'export const config = 1;\n', 'utf8');
    await writeFile(
      path.join(dir, 'app.ts'),
      "import { config } from '@config';\nimport { extra } from '@config/extra';\nvoid config; void extra;\n",
      'utf8',
    );
    const result = await scanProject({
      root: dir,
      config: { ...DEFAULT_CONFIG, include: ['**/*.ts'], exclude: [] },
    });
    const phantom = result.findings.filter((finding) => finding.ruleId === 'ts/phantom-import');
    assert.equal(phantom.length, 1);
    assert.match(phantom[0]?.message ?? '', /@config\/extra/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tsconfig wildcard paths accept existing local roots but not missing packages', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-tsconfig-wildcard-'));
  try {
    await mkdir(path.join(dir, 'src', 'utils'), { recursive: true });
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '*': ['src/*'] } } }),
      'utf8',
    );
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'wildcard', version: '0.0.0' }),
      'utf8',
    );
    await writeFile(path.join(dir, 'src', 'utils', 'foo.ts'), 'export const foo = 1;\n', 'utf8');
    await writeFile(
      path.join(dir, 'app.ts'),
      "import { foo } from 'utils/foo';\nimport leftPad from 'left-pad';\nvoid foo; void leftPad;\n",
      'utf8',
    );
    const result = await scanProject({
      root: dir,
      config: { ...DEFAULT_CONFIG, include: ['**/*.ts'], exclude: [] },
    });
    const phantom = result.findings.filter((finding) => finding.ruleId === 'ts/phantom-import');
    assert.equal(phantom.length, 1);
    assert.match(phantom[0]?.message ?? '', /left-pad/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
