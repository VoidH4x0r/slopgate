import assert from 'node:assert/strict';
import test from 'node:test';
import { makeDeps, runRule, runRuleOnFile, scanFixture } from './helpers.ts';

test('go/phantom-import reports unresolved external modules', async () => {
  const deps = makeDeps({ goModule: 'example.com/demo', goManifests: ['go.mod'] });
  const drafts = await runRule('go/phantom-import', 'package main\n\nimport "github.com/nope/pkg"\n', 'go', deps);
  assert.equal(drafts.length, 1);
  assert.match(drafts[0]?.message ?? '', /github.com\/nope\/pkg/);
});

test('go/phantom-import accepts stdlib, module and required paths', async () => {
  const source = [
    'package main',
    '',
    'import (',
    '  "fmt"',
    '  "encoding/json"',
    '  "example.com/demo/internal/x"',
    '  "github.com/acme/lib"',
    ')',
    '',
  ].join('\n');
  const deps = makeDeps({
    goModule: 'example.com/demo',
    goRequires: ['github.com/acme/lib'],
    goManifests: ['go.mod'],
  });
  assert.deepEqual(await runRule('go/phantom-import', source, 'go', deps), []);
});

test('go/phantom-import does not guess without go.mod', async () => {
  const drafts = await runRule(
    'go/phantom-import',
    'package main\n\nimport "github.com/nope/pkg"\n',
    'go',
    makeDeps(),
  );
  assert.deepEqual(drafts, []);
});

test('go/unreachable reports statements after return', async () => {
  const source = [
    'package main',
    '',
    'func f() int {',
    '  return 1',
    '  println("dead")',
    '}',
    '',
  ].join('\n');
  const drafts = await runRule('go/unreachable', source, 'go');
  assert.equal(drafts.length, 1);
  assert.match(drafts[0]?.message ?? '', /unreachable/);
});

test('go/stub-body reports a not-implemented panic', async () => {
  const source = 'package main\n\nfunc f() {\n  panic("not implemented")\n}\n';
  const drafts = await runRule('go/stub-body', source, 'go');
  assert.equal(drafts.length, 1);
});

test('go/stub-body accepts an empty method body', async () => {
  const source = 'package main\n\ntype T struct{}\n\nfunc (t T) M() {}\n';
  assert.deepEqual(await runRule('go/stub-body', source, 'go'), []);
});

test('go/swallowed-error reports an empty error branch', async () => {
  const source = [
    'package main',
    '',
    'func f() error {',
    '  var err error',
    '  if err != nil {',
    '  }',
    '  return nil',
    '}',
    '',
  ].join('\n');
  const drafts = await runRule('go/swallowed-error', source, 'go');
  assert.equal(drafts.length, 1);
});

test('go/swallowed-error accepts handled or commented errors', async () => {
  const handled = [
    'package main',
    '',
    'func f() error {',
    '  var err error',
    '  if err != nil {',
    '    return err',
    '  }',
    '  return nil',
    '}',
    '',
  ].join('\n');
  assert.deepEqual(await runRule('go/swallowed-error', handled, 'go'), []);
});

test('go/noop-test flags an empty Test function', async () => {
  const source = 'package main\n\nimport "testing"\n\nfunc TestX(t *testing.T) {\n}\n';
  const drafts = await runRuleOnFile('go/noop-test', source, 'go', 'x_test.go');
  assert.equal(drafts.length, 1);
});

test('go/noop-test accepts assertions, skips and helper calls', async () => {
  const asserted = 'package main\n\nimport "testing"\n\nfunc TestX(t *testing.T) {\n  t.Error("bad")\n}\n';
  assert.deepEqual(await runRuleOnFile('go/noop-test', asserted, 'go', 'x_test.go'), []);
  const skipped = 'package main\n\nimport "testing"\n\nfunc TestX(t *testing.T) {\n  t.Skip("later")\n}\n';
  assert.deepEqual(await runRuleOnFile('go/noop-test', skipped, 'go', 'x_test.go'), []);
  const helper = 'package main\n\nimport "testing"\n\nfunc TestX(t *testing.T) {\n  check(t)\n}\n';
  assert.deepEqual(await runRuleOnFile('go/noop-test', helper, 'go', 'x_test.go'), []);
});

test('go/phantom-import accepts stdlib internal packages', async () => {
  const deps = makeDeps({ goModule: 'std', goManifests: ['go.mod'] });
  assert.deepEqual(
    await runRule(
      'go/phantom-import',
      'package main\n\nimport "internal/godebug"\n',
      'go',
      deps,
    ),
    [],
  );
});

test('go/unreachable skips blocks with goto or labels', async () => {
  const source = [
    'package main',
    '',
    'func f() int {',
    '  goto done',
    '  return 1',
    'done:',
    '  return 2',
    '}',
    '',
  ].join('\n');
  assert.deepEqual(await runRule('go/unreachable', source, 'go'), []);
});

test('go/stub-body skips build-tag fallback files', async () => {
  const source = [
    '//go:build !amd64',
    '',
    'package main',
    '',
    'func f() {',
    '  panic("unimplemented")',
    '}',
    '',
  ].join('\n');
  assert.deepEqual(await runRule('go/stub-body', source, 'go'), []);
});

test('go/noop-test skips an empty test with an explanatory comment', async () => {
  const source = [
    'package main',
    '',
    'import "testing"',
    '',
    '// The test is that the package compiles.',
    'func TestCompile(t *testing.T) {',
    '}',
    '',
  ].join('\n');
  assert.deepEqual(await runRuleOnFile('go/noop-test', source, 'go', 'x_test.go'), []);
});

test('go fixture reports the six Go rule families and skips generated/test files', async () => {
  const result = await scanFixture('go-demo', {}, [
    'go/phantom-import',
    'go/noop-test',
    'go/unreachable',
    'go/stub-body',
    'go/swallowed-error',
    'go/duplicate-block',
  ]);
  assert.equal(result.stats.byLanguage.go, 7);
  assert.deepEqual(
    result.findings.map((finding) => finding.ruleId).sort(),
    [
      'go/duplicate-block',
      'go/duplicate-block',
      'go/noop-test',
      'go/phantom-import',
      'go/stub-body',
      'go/swallowed-error',
      'go/unreachable',
    ],
  );
  assert.ok(result.findings.every((finding) => !finding.file.includes('generated.go')));
  assert.ok(result.findings.every((finding) => !finding.file.endsWith('clean_test.go')));
});

test('go-fixtures parses 20 clean Go files', async () => {
  const result = await scanFixture('go-fixtures');
  assert.equal(result.stats.byLanguage.go, 20);
  assert.equal(result.stats.parseErrors, 0);
  assert.deepEqual(result.findings, []);
});
