import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';
import { discoverFiles, globToRegExp, languageFor, toPosix } from '../src/files.ts';
import { FIXTURES } from './helpers.ts';

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
