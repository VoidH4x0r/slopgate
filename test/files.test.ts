import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { dialectFor, discoverFiles, globToRegExp, languageFor, toPosix } from '../src/files.ts';
import { FIXTURES, ROOT } from './helpers.ts';

test('globToRegExp: ** matches any depth, * stays in one segment', () => {
  assert.ok(globToRegExp('**/*.py').test('app.py'));
  assert.ok(globToRegExp('**/*.py').test('src/deep/app.py'));
  assert.ok(!globToRegExp('**/*.py').test('app.ts'));
  assert.ok(!globToRegExp('src/*.py').test('src/deep/app.py'));
  assert.ok(globToRegExp('src/*.py').test('src/app.py'));
});

test('globToRegExp: escapes regex metacharacters', () => {
  const pattern = globToRegExp('a+b(1).py');
  assert.ok(pattern.test('a+b(1).py'));
  assert.ok(!pattern.test('aab(1).py'));
});

test('globToRegExp: brace alternatives, including nested braces', () => {
  const ts = globToRegExp('**/*.{ts,tsx}');
  assert.ok(ts.test('a.ts'));
  assert.ok(ts.test('src/deep/a.tsx'));
  assert.ok(!ts.test('a.js'));
  assert.ok(globToRegExp('src/{a,b}/*.py').test('src/b/x.py'));
  assert.ok(globToRegExp('{a,{b,c}}.py').test('c.py'));
  assert.ok(!globToRegExp('{a,{b,c}}.py').test('d.py'));
});

test('languageFor maps JavaScript (including JSX) to the tsx grammar', () => {
  assert.equal(languageFor('a.js'), 'tsx');
  assert.equal(languageFor('a.mjs'), 'tsx');
  assert.equal(languageFor('a.cjs'), 'tsx');
  assert.equal(languageFor('a.jsx'), 'tsx');
  assert.equal(languageFor('a.ts'), 'typescript');
});

test('dialectFor reports the human-facing language, not the grammar', () => {
  assert.equal(dialectFor('a.js'), 'javascript');
  assert.equal(dialectFor('a.jsx'), 'javascript');
  assert.equal(dialectFor('a.mjs'), 'javascript');
  assert.equal(dialectFor('a.ts'), 'typescript');
  assert.equal(dialectFor('a.tsx'), 'tsx');
  assert.equal(dialectFor('a.pyi'), 'python');
  assert.equal(dialectFor('a.d.ts'), undefined);
});

test('every supported extension has both a grammar and a dialect', () => {
  for (const extension of ['.py', '.pyi', '.ts', '.mts', '.cts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
    assert.ok(languageFor(`file${extension}`), `missing language for ${extension}`);
    assert.ok(dialectFor(`file${extension}`), `missing dialect for ${extension}`);
  }
});

test('languageFor maps extensions and skips declaration files', () => {
  assert.equal(languageFor('a.py'), 'python');
  assert.equal(languageFor('a.pyi'), 'python');
  assert.equal(languageFor('a.ts'), 'typescript');
  assert.equal(languageFor('a.mts'), 'typescript');
  assert.equal(languageFor('a.tsx'), 'tsx');
  assert.equal(languageFor('a.jsx'), 'tsx');
  assert.equal(languageFor('a.d.ts'), undefined);
  assert.equal(languageFor('a.md'), undefined);
});

test('toPosix normalises separators', () => {
  assert.equal(toPosix('src\\app.py'), 'src/app.py');
});

test('discoverFiles finds python and typescript sources in a fixture', async () => {
  const root = path.join(FIXTURES, 'demo');
  const { files } = await discoverFiles({ root });
  assert.deepEqual(
    files.map((file) => file.rel),
    ['app.py', 'deps_ok.py', 'src/agent.ts', 'tests/test_users.py'],
  );
  assert.deepEqual(
    files.map((file) => file.language),
    ['python', 'python', 'typescript', 'python'],
  );
  assert.deepEqual(
    files.map((file) => file.dialect),
    ['python', 'python', 'typescript', 'python'],
  );
});

test('discoverFiles honours exclude patterns', async () => {
  const root = path.join(FIXTURES, 'demo');
  const { files } = await discoverFiles({ root, exclude: ['src/**'] });
  assert.ok(files.every((file) => !file.rel.startsWith('src/')));
  assert.equal(files.length, 3);
});

test('discoverFiles accepts a single file path', async () => {
  const file = path.join(FIXTURES, 'demo', 'app.py');
  const { files } = await discoverFiles({ root: file });
  assert.deepEqual(files.map((entry) => entry.rel), ['app.py']);
  assert.equal(files[0]?.language, 'python');

  const ignored = await discoverFiles({ root: path.join(FIXTURES, 'demo', 'pyproject.toml') });
  assert.deepEqual(ignored.files, []);
});

test('discoverFiles does not count ignored directories as skipped files', async () => {
  const dir = await mkdtemp(path.join(ROOT, 'test', '.tmp-skip-'));
  try {
    await mkdir(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'export {};\n', 'utf8');
    const result = await discoverFiles({ root: dir });
    assert.deepEqual(result.files, []);
    assert.equal(result.skipped, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
