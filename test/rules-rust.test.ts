import assert from 'node:assert/strict';
import test from 'node:test';
import { makeDeps, runRule, runRuleOnFile, scanFixture } from './helpers.ts';

test('rs/phantom-import reports unresolved crate paths', async () => {
  const deps = makeDeps({ rustManifests: ['Cargo.toml'], rustDependencies: ['serde'] });
  const drafts = await runRule('rs/phantom-import', 'use missing::Thing;\n', 'rust', deps);
  assert.equal(drafts.length, 1);
  assert.match(drafts[0]?.message ?? '', /missing/);
});

test('rs/phantom-import accepts std, dependencies, crate and local modules', async () => {
  const source = [
    'use std::collections::HashMap;',
    'use serde::Serialize;',
    'use crate::util::helper;',
    'use util::helper;',
    'use self::inner::Thing;',
    '',
  ].join('\n');
  const deps = makeDeps({
    rustManifests: ['Cargo.toml'],
    rustDependencies: ['serde'],
    rustLocal: ['util', 'inner'],
  });
  assert.deepEqual(await runRule('rs/phantom-import', source, 'rust', deps), []);
});

test('rs/phantom-import stays silent without Cargo.toml', async () => {
  assert.deepEqual(
    await runRule('rs/phantom-import', 'use missing::Thing;\n', 'rust', makeDeps()),
    [],
  );
});

test('rs/phantom-import handles aliases, group imports and raw crate names', async () => {
  const deps = makeDeps({ rustManifests: ['Cargo.toml'], rustDependencies: ['serde'] });
  for (const source of [
    'use serde as s;\n',
    'use {serde, std::fmt};\n',
    'use {serde as s, std::fmt};\n',
    'use r#serde::Serialize;\n',
  ]) {
    assert.deepEqual(await runRule('rs/phantom-import', source, 'rust', deps), [], source);
  }
});

test('rs/phantom-import accepts the own crate name', async () => {
  const deps = makeDeps({
    rustManifests: ['Cargo.toml'],
    rustCrate: 'my-crate',
  });
  assert.deepEqual(
    await runRule('rs/phantom-import', 'use my_crate::helper;\n', 'rust', deps),
    [],
  );
});

test('rs/stub-body skips cfg(all(test, ...)) and root sys/', async () => {
  assert.deepEqual(
    await runRule(
      'rs/stub-body',
      '#[cfg(all(test, unix))]\nfn helper() {\n    todo!()\n}\n',
      'rust',
    ),
    [],
  );
  assert.deepEqual(
    await runRuleOnFile('rs/stub-body', 'fn pal() {\n    todo!()\n}\n', 'rust', 'sys/pal.rs'),
    [],
  );
});

test('rs/noop-test flags an empty #[test]', async () => {
  const source = '#[test]\nfn t() {}\n';
  const drafts = await runRuleOnFile('rs/noop-test', source, 'rust', 'src/lib.rs');
  assert.equal(drafts.length, 1);
});

test('rs/noop-test accepts assertions, ignore and explanatory comments', async () => {
  assert.deepEqual(
    await runRuleOnFile('rs/noop-test', '#[test]\nfn t() { assert_eq!(1, 1); }\n', 'rust', 'src/lib.rs'),
    [],
  );
  assert.deepEqual(
    await runRuleOnFile('rs/noop-test', '#[test]\n#[ignore]\nfn t() {}\n', 'rust', 'src/lib.rs'),
    [],
  );
  assert.deepEqual(
    await runRuleOnFile(
      'rs/noop-test',
      '// This test only checks that the crate compiles.\n#[test]\nfn t() {}\n',
      'rust',
      'src/lib.rs',
    ),
    [],
  );
});

test('rs/unreachable reports statements after return', async () => {
  const source = 'fn f() {\n    return;\n    println!("dead");\n}\n';
  const drafts = await runRule('rs/unreachable', source, 'rust');
  assert.equal(drafts.length, 1);
});

test('rs/stub-body reports todo/unimplemented macros', async () => {
  for (const body of ['todo!()', 'unimplemented!()', 'panic!("not implemented")']) {
    const drafts = await runRule('rs/stub-body', `fn f() {\n    ${body}\n}\n`, 'rust');
    assert.equal(drafts.length, 1, body);
  }
});

test('rs/stub-body accepts an empty function and a normal panic', async () => {
  assert.deepEqual(await runRule('rs/stub-body', 'fn f() {}\n', 'rust'), []);
  assert.deepEqual(
    await runRule('rs/stub-body', 'fn f() {\n    panic!("boom");\n}\n', 'rust'),
    [],
  );
});

test('rs/swallowed-error reports an empty if-let Err branch', async () => {
  const source = 'fn f(r: Result<(), E>) {\n    if let Err(_) = r {\n    }\n}\n';
  const drafts = await runRule('rs/swallowed-error', source, 'rust');
  assert.equal(drafts.length, 1);
});

test('rs/swallowed-error accepts a handled or commented branch', async () => {
  assert.deepEqual(
    await runRule(
      'rs/swallowed-error',
      'fn f(r: Result<(), E>) {\n    if let Err(_) = r {\n        return;\n    }\n}\n',
      'rust',
    ),
    [],
  );
  assert.deepEqual(
    await runRule(
      'rs/swallowed-error',
      'fn f(r: Result<(), E>) {\n    if let Err(_) = r {\n        // intentionally ignored\n    }\n}\n',
      'rust',
    ),
    [],
  );
});

test('rust fixture reports all six Rust rule families and skips generated files', async () => {
  const result = await scanFixture('rust-demo', {}, [
    'rs/phantom-import',
    'rs/noop-test',
    'rs/unreachable',
    'rs/stub-body',
    'rs/swallowed-error',
    'rs/duplicate-block',
  ]);
  assert.equal(result.stats.byLanguage.rust, 7);
  assert.deepEqual(
    result.findings.map((finding) => finding.ruleId).sort(),
    [
      'rs/duplicate-block',
      'rs/duplicate-block',
      'rs/noop-test',
      'rs/phantom-import',
      'rs/stub-body',
      'rs/swallowed-error',
      'rs/unreachable',
    ],
  );
  assert.ok(result.findings.every((finding) => !finding.file.includes('generated.rs')));
});

test('rust-fixtures parses 20 clean Rust files', async () => {
  const result = await scanFixture('rust-fixtures');
  assert.equal(result.stats.byLanguage.rust, 20);
  assert.equal(result.stats.parseErrors, 0);
  assert.deepEqual(result.findings, []);
});
