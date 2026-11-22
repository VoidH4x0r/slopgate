import assert from 'node:assert/strict';
import test from 'node:test';
import { makeDeps, runRule, runRuleOnFile } from './helpers.ts';

test('ts/phantom-import flags a package that is neither declared nor installed', async () => {
  const drafts = await runRule('ts/phantom-import', "import lodash from 'lodash';\n", 'typescript');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'high');
});

test('ts/phantom-import downgrades to medium when the package is installed but undeclared', async () => {
  const deps = makeDeps({ nodeInstalled: ['lodash'] });
  const drafts = await runRule('ts/phantom-import', "import lodash from 'lodash';\n", 'typescript', deps);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'medium');
});

test('ts/phantom-import stays quiet for declared, builtin, relative, alias and asset imports', async () => {
  const source = [
    "import lodash from 'lodash';",
    "import fs from 'node:fs';",
    "import path from 'path';",
    "import local from './local.js';",
    "import { helper } from '@/lib/helper';",
    "import styles from './styles.css';",
    "import button from 'design-system/button.css';",
  ].join('\n');
  const deps = makeDeps({ nodeDeclared: ['lodash', 'design-system'], nodeAliases: ['@'] });
  const drafts = await runRule('ts/phantom-import', source, 'typescript', deps);
  assert.deepEqual(drafts, []);
});

test('ts/phantom-import resolves scoped packages to their root', async () => {
  const deps = makeDeps({ nodeDeclared: ['@scope/pkg'] });
  const drafts = await runRule('ts/phantom-import', "import { z } from '@scope/pkg/sub';\n", 'typescript', deps);
  assert.deepEqual(drafts, []);
});

test('ts/phantom-import also checks require() calls and re-exports', async () => {
  const drafts = await runRule(
    'ts/phantom-import',
    ["const x = require('missing-pkg');", "export { y } from 'other-missing';"].join('\n'),
    'typescript',
  );
  assert.equal(drafts.length, 2);
});

test('ts/phantom-import ignores URL imports and optional requires', async () => {
  const source = [
    "import cliui from 'https://unpkg.com/cliui@8/index.mjs';",
    'try {',
    "  const optional = require('optional-color-helper');",
    '} catch {}',
  ].join('\n');
  assert.deepEqual(await runRule('ts/phantom-import', source, 'typescript'), []);
});

test('ts/noop-test flags empty and assertion-free tests', async () => {
  const empty = await runRule('ts/noop-test', "test('a', () => {});\n", 'typescript');
  assert.equal(empty.length, 1);
  assert.match(empty[0]?.message ?? '', /empty body/);

  const noAssert = await runRule('ts/noop-test', "it('a', async () => { await run(); });\n", 'typescript');
  assert.equal(noAssert.length, 1);

  const expressionBody = await runRule('ts/noop-test', "test('a', () => doThing());\n", 'typescript');
  assert.equal(expressionBody.length, 1);
});

test('ts/noop-test accepts tests that assert', async () => {
  const drafts = await runRule('ts/noop-test', "test('a', () => { expect(doThing()).toBe(1); });\n", 'typescript');
  assert.deepEqual(drafts, []);
});

test('ts/noop-test recognises node:assert method assertions', async () => {
  const source = [
    "import assert from 'node:assert/strict';",
    "import { test } from 'node:test';",
    "test('strictEqual', () => { assert.strictEqual(1 + 1, 2); });",
    "test('ok', () => { assert.ok(1 + 1 === 2); });",
    "test('deepStrictEqual', () => { assert.deepStrictEqual({ a: 1 }, { a: 1 }); });",
    "test('notEqual', () => { assert.notEqual(1, 2); });",
    "test('match', () => { assert.match('hello', /ell/); });",
    "test('context', (t) => { t.ok(true); });",
  ].join('\n');
  const drafts = await runRule('ts/noop-test', source, 'typescript');
  assert.deepEqual(drafts, []);
});

test('ts/noop-test still flags a test with no assertion', async () => {
  const source = [
    "import { test } from 'node:test';",
    "test('nothing', () => { console.log('hi'); });",
  ].join('\n');
  const drafts = await runRule('ts/noop-test', source, 'typescript');
  assert.equal(drafts.length, 1);
  assert.match(drafts[0]?.message ?? '', /no assertions/);
});

test('ts/noop-test does not treat test.<data>.forEach() as a test', async () => {
  const source = [
    "import { test } from 'node:test';",
    'test.valid.forEach((valid, index) => { run(valid, index); });',
    'test.invalid.forEach((invalid, index) => { run(invalid, index); });',
    'test.only("real", () => { assert.ok(true); });',
  ].join('\n');
  const drafts = await runRule('ts/noop-test', source, 'typescript');
  assert.deepEqual(drafts, []);
});

test('ts/tautological-assert finds self-comparisons', async () => {
  assert.equal((await runRule('ts/tautological-assert', 'expect(true).toBe(true);\n', 'typescript')).length, 1);
  assert.equal((await runRule('ts/tautological-assert', 'expect(x).toEqual(x);\n', 'typescript')).length, 1);
});

test('ts/tautological-assert accepts real assertions', async () => {
  assert.deepEqual(await runRule('ts/tautological-assert', 'expect(add(1, 2)).toBe(3);\n', 'typescript'), []);
  assert.deepEqual(await runRule('ts/tautological-assert', 'expect(a).toBe(b);\n', 'typescript'), []);
});

test('ts/stub-function flags empty and not-implemented bodies', async () => {
  const empty = await runRule('ts/stub-function', 'export function stub() {}\n', 'typescript');
  assert.equal(empty.length, 1);
  assert.equal(empty[0]?.confidence, 'medium');

  const notImplemented = await runRule(
    'ts/stub-function',
    "export function stub() { throw new Error('not implemented'); }\n",
    'typescript',
  );
  assert.equal(notImplemented.length, 1);
  assert.equal(notImplemented[0]?.confidence, 'high');

  assert.equal((await runRule('ts/stub-function', 'class A { m() {} }\n', 'typescript')).length, 1);
});

test('ts/stub-function ignores noop conventions and abstract JSDoc', async () => {
  assert.deepEqual(await runRule('ts/stub-function', 'function noop() {}\n', 'typescript'), []);
  assert.deepEqual(await runRule('ts/stub-function', 'function noOp() {}\n', 'typescript'), []);

  const documented = [
    '/**',
    ' * @abstract',
    ' */',
    "method() { throw new Error('Not implemented.'); }",
  ].join('\n');
  assert.deepEqual(await runRule('ts/stub-function', documented, 'typescript'), []);
});

test('ts/stub-function ignores constructors, empty arrows and real bodies', async () => {
  assert.deepEqual(await runRule('ts/stub-function', 'class A { constructor() {} }\n', 'typescript'), []);
  assert.deepEqual(await runRule('ts/stub-function', 'const noop = () => {};\n', 'typescript'), []);
  assert.deepEqual(await runRule('ts/stub-function', 'function f() { return 1; }\n', 'typescript'), []);
  assert.deepEqual(
    await runRule('ts/stub-function', 'abstract class A { abstract m(): void; }\n', 'typescript'),
    [],
  );
});

test('ts/stub-function flags arrows that throw not-implemented', async () => {
  const chunks = (await runRule('ts/stub-function', "const todo = () => { throw new Error('not implemented'); };\n", 'typescript'));
  assert.equal(chunks.length, 1);
});

test('ts/swallowed-exception flags empty catch blocks at medium confidence', async () => {
  const source = 'function f() {\n  try { go(); } catch (error) {}\n}\n';
  const drafts = await runRule('ts/swallowed-exception', source, 'typescript');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'medium');
});

test('ts/swallowed-exception ignores handlers that log', async () => {
  const source = 'function f() {\n  try { go(); } catch (error) { console.error(error); }\n}\n';
  assert.deepEqual(await runRule('ts/swallowed-exception', source, 'typescript'), []);
});

test('ts/dead-branch flags constant conditions but keeps while(true)', async () => {
  assert.equal((await runRule('ts/dead-branch', 'if (false) { go(); }\n', 'typescript')).length, 1);
  assert.equal((await runRule('ts/dead-branch', 'if (true) { go(); }\n', 'typescript'))[0]?.confidence, 'medium');
  assert.deepEqual(await runRule('ts/dead-branch', 'while (true) { go(); }\n', 'typescript'), []);
});

test('ts/unreachable flags statements after exits', async () => {
  assert.equal((await runRule('ts/unreachable', 'function f() { return 1; go(); }\n', 'typescript')).length, 1);
  assert.equal((await runRule('ts/unreachable', 'function f() { throw new Error(); go(); }\n', 'typescript')).length, 1);
  assert.deepEqual(await runRule('ts/unreachable', 'function f() { return 1; }\n', 'typescript'), []);
});

test('ts rules skip test files where the scaffolding is intentional', async () => {
  const stub = 'export function stub() {}\n';
  assert.deepEqual(await runRuleOnFile('ts/stub-function', stub, 'typescript', 'src/app.test.ts'), []);
  assert.equal((await runRuleOnFile('ts/stub-function', stub, 'typescript', 'src/app.ts')).length, 1);

  const dead = 'if (false) { go(); }\n';
  assert.deepEqual(await runRuleOnFile('ts/dead-branch', dead, 'typescript', 'src/app.spec.ts'), []);

  const emptyCatch = 'try { go(); } catch {}\n';
  assert.deepEqual(await runRuleOnFile('ts/swallowed-exception', emptyCatch, 'typescript', 'src/__tests__/a.ts'), []);
});

test('ts/phantom-import is only medium confidence inside test files', async () => {
  const drafts = await runRuleOnFile(
    'ts/phantom-import',
    "import x from 'missing-pkg';\n",
    'typescript',
    'src/app.test.ts',
  );
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'medium');
});
