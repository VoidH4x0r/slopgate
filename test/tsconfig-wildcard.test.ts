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

test('tsconfig @* / ~* wildcard keys match prefixes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-tsconfig-at-'));
  try {
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@*': ['src/*'], '~*': ['src/*'] } } }),
      'utf8',
    );
    await writeFile(path.join(dir, 'package.json'), '{"name":"at","version":"0.0.0"}\n', 'utf8');
    await writeFile(path.join(dir, 'src', 'foo.ts'), 'export const foo = 1;\n', 'utf8');
    await writeFile(
      path.join(dir, 'app.ts'),
      "import { foo } from '@foo';\nimport { foo as bar } from '~foo';\nvoid foo; void bar;\n",
      'utf8',
    );
    const result = await scanProject({
      root: dir,
      config: { ...DEFAULT_CONFIG, include: ['**/*.ts'], exclude: [] },
    });
    assert.equal(
      result.findings.filter((finding) => finding.ruleId === 'ts/phantom-import').length,
      0,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('child paths replace inherited paths instead of merging', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-tsconfig-replace-'));
  try {
    await mkdir(path.join(dir, 'src', 'old'), { recursive: true });
    await mkdir(path.join(dir, 'src', 'new'), { recursive: true });
    await writeFile(
      path.join(dir, 'tsconfig.base.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@old/*': ['src/old/*'] } } }),
      'utf8',
    );
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        extends: './tsconfig.base.json',
        compilerOptions: { paths: { '@new/*': ['src/new/*'] } },
      }),
      'utf8',
    );
    await writeFile(path.join(dir, 'package.json'), '{"name":"replace","version":"0.0.0"}\n', 'utf8');
    await writeFile(path.join(dir, 'src', 'old', 'foo.ts'), 'export const foo = 1;\n', 'utf8');
    await writeFile(path.join(dir, 'src', 'new', 'bar.ts'), 'export const bar = 1;\n', 'utf8');
    await writeFile(
      path.join(dir, 'app.ts'),
      "import { foo } from '@old/foo';\nimport { bar } from '@new/bar';\nvoid foo; void bar;\n",
      'utf8',
    );
    const result = await scanProject({
      root: dir,
      config: { ...DEFAULT_CONFIG, include: ['**/*.ts'], exclude: [] },
    });
    const phantom = result.findings.filter((finding) => finding.ruleId === 'ts/phantom-import');
    assert.equal(phantom.length, 1);
    assert.match(phantom[0]?.message ?? '', /@old\/foo/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@* wildcard does not accept a missing scoped package', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-tsconfig-at-missing-'));
  try {
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@*': ['src/*'] } } }),
      'utf8',
    );
    await writeFile(path.join(dir, 'package.json'), '{"name":"at-missing","version":"0.0.0"}\n', 'utf8');
    await writeFile(path.join(dir, 'src', 'foo.ts'), 'export const foo = 1;\n', 'utf8');
    await writeFile(
      path.join(dir, 'app.ts'),
      "import { foo } from '@foo';\nimport { pkg } from '@scope/pkg';\nvoid foo; void pkg;\n",
      'utf8',
    );
    const result = await scanProject({
      root: dir,
      config: { ...DEFAULT_CONFIG, include: ['**/*.ts'], exclude: [] },
    });
    const phantom = result.findings.filter((finding) => finding.ruleId === 'ts/phantom-import');
    assert.equal(phantom.length, 1);
    assert.match(phantom[0]?.message ?? '', /@scope\/pkg/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('referenced project paths are not inherited', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-tsconfig-ref-'));
  try {
    await mkdir(path.join(dir, 'src', 'old'), { recursive: true });
    await writeFile(
      path.join(dir, 'tsconfig.lib.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@old/*': ['src/old/*'] } } }),
      'utf8',
    );
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ references: [{ path: './tsconfig.lib.json' }] }),
      'utf8',
    );
    await writeFile(path.join(dir, 'package.json'), '{"name":"ref","version":"0.0.0"}\n', 'utf8');
    await writeFile(path.join(dir, 'src', 'old', 'foo.ts'), 'export const foo = 1;\n', 'utf8');
    await writeFile(
      path.join(dir, 'app.ts'),
      "import { foo } from '@old/foo';\nvoid foo;\n",
      'utf8',
    );
    const result = await scanProject({
      root: dir,
      config: { ...DEFAULT_CONFIG, include: ['**/*.ts'], exclude: [] },
    });
    const phantom = result.findings.filter((finding) => finding.ruleId === 'ts/phantom-import');
    assert.equal(phantom.length, 1);
    assert.match(phantom[0]?.message ?? '', /@old\/foo/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@* wildcard accepts a directory index but not a missing child', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-tsconfig-index-'));
  try {
    await mkdir(path.join(dir, 'src', 'scope', 'pkg'), { recursive: true });
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@*': ['src/*'] } } }),
      'utf8',
    );
    await writeFile(path.join(dir, 'package.json'), '{"name":"at-index","version":"0.0.0"}\n', 'utf8');
    await writeFile(
      path.join(dir, 'src', 'scope', 'pkg', 'index.ts'),
      'export const pkg = 1;\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'app.ts'),
      "import { pkg } from '@scope/pkg';\nimport { child } from '@scope/pkg/child';\nvoid pkg; void child;\n",
      'utf8',
    );
    const result = await scanProject({
      root: dir,
      config: { ...DEFAULT_CONFIG, include: ['**/*.ts'], exclude: [] },
    });
    const phantom = result.findings.filter((finding) => finding.ruleId === 'ts/phantom-import');
    assert.equal(phantom.length, 1);
    assert.match(phantom[0]?.message ?? '', /@scope\/pkg/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('root * and baseUrl aliases do not accept missing children', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-root-wildcard-'));
  try {
    await mkdir(path.join(dir, 'src', 'utils'), { recursive: true });
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '*': ['src/*'] } } }),
      'utf8',
    );
    await writeFile(path.join(dir, 'package.json'), '{"name":"root-wildcard","version":"0.0.0"}\n', 'utf8');
    await writeFile(path.join(dir, 'src', 'utils', 'foo.ts'), 'export const foo = 1;\n', 'utf8');
    await writeFile(
      path.join(dir, 'app.ts'),
      "import { foo } from 'utils/foo';\nimport { missing } from 'utils/missing';\nvoid foo; void missing;\n",
      'utf8',
    );
    const result = await scanProject({
      root: dir,
      config: { ...DEFAULT_CONFIG, include: ['**/*.ts'], exclude: [] },
    });
    const phantom = result.findings.filter((finding) => finding.ruleId === 'ts/phantom-import');
    assert.equal(phantom.length, 1);
    assert.match(phantom[0]?.message ?? '', /utils/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('baseUrl only aliases real files, not missing children', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-baseurl-exact-'));
  try {
    await mkdir(path.join(dir, 'src', 'components'), { recursive: true });
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: './src' } }),
      'utf8',
    );
    await writeFile(path.join(dir, 'package.json'), '{"name":"baseurl-exact","version":"0.0.0"}\n', 'utf8');
    await writeFile(path.join(dir, 'src', 'components', 'button.ts'), 'export const button = 1;\n', 'utf8');
    await writeFile(
      path.join(dir, 'app.ts'),
      "import { button } from 'components/button';\nimport { missing } from 'components/missing';\nvoid button; void missing;\n",
      'utf8',
    );
    const result = await scanProject({
      root: dir,
      config: { ...DEFAULT_CONFIG, include: ['**/*.ts'], exclude: [] },
    });
    const phantom = result.findings.filter((finding) => finding.ruleId === 'ts/phantom-import');
    assert.equal(phantom.length, 1);
    assert.match(phantom[0]?.message ?? '', /components/);
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
