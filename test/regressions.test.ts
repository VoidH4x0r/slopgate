import assert from 'node:assert/strict';
import test from 'node:test';
import { scanFixture } from './helpers.ts';

function ruleFindings(
  result: Awaited<ReturnType<typeof scanFixture>>,
  ruleId: string,
): Awaited<ReturnType<typeof scanFixture>>['findings'] {
  return result.findings.filter((finding) => finding.ruleId === ruleId);
}

test('regression: .pyi type stubs are not reported as stub bodies', async () => {
  const result = await scanFixture('regressions/pyi');
  assert.equal(ruleFindings(result, 'py/stub-body').length, 0);
  const phantom = ruleFindings(result, 'py/phantom-import');
  assert.ok(
    phantom.some((finding) => finding.file === 'app.py' && finding.confidence === 'high'),
    'a genuinely undeclared import must still be reported',
  );
  assert.ok(
    phantom.some((finding) => finding.file === 'conftest.py' && finding.confidence === 'medium'),
    'test infrastructure imports are demoted, not dropped',
  );
});

test('regression: modern pyproject dependency sections are all read', async () => {
  const result = await scanFixture('regressions/py-manifests');
  assert.deepEqual(ruleFindings(result, 'py/phantom-import'), []);
});

test('regression: common import-name to distribution-name mappings', async () => {
  const result = await scanFixture('regressions/py-dist');
  assert.deepEqual(ruleFindings(result, 'py/phantom-import'), []);
});

test('regression: node:assert method assertions are recognised', async () => {
  const result = await scanFixture('regressions/ts-assert');
  assert.deepEqual(ruleFindings(result, 'ts/noop-test'), []);
});

test('regression: a comment between try and except demotes swallowed exceptions', async () => {
  const result = await scanFixture('regressions/py-comment');
  const swallowed = ruleFindings(result, 'py/swallowed-exception');
  assert.equal(swallowed.filter((finding) => finding.confidence === 'high').length, 0);
  assert.equal(swallowed.length, 2);
  assert.ok(swallowed.every((finding) => finding.confidence === 'medium'));
});

test('regression: dummy/no-op modules are not unfinished stubs', async () => {
  const result = await scanFixture('regressions/py-dummy');
  assert.deepEqual(ruleFindings(result, 'py/stub-body'), []);
});

test('regression: JSX inside .js parses and still reports a real stub', async () => {
  const result = await scanFixture('regressions/js-jsx');
  assert.equal(result.stats.parseErrors, 0);
  const stubs = ruleFindings(result, 'ts/stub-function');
  assert.ok(
    stubs.some((finding) => finding.confidence === 'high' && finding.message.includes('not implemented')),
    'the explicit not-implemented stub is high confidence',
  );
});

test('regression: brace globs in config discover both extensions', async () => {
  const result = await scanFixture('regressions/globcase');
  assert.equal(result.stats.files, 2);
});

test('regression: pyproject extras, groups, include-group, uv and poetry groups', async () => {
  const result = await scanFixture('regressions/pyproject-edge');
  assert.deepEqual(ruleFindings(result, 'py/phantom-import'), []);
});

test('regression: test.runIf/test.skipIf are analysed but assertXxx helpers count', async () => {
  const result = await scanFixture('regressions/assert-helpers');
  const findings = ruleFindings(result, 'ts/noop-test');
  // The three assertEqual/assertNotNull/assertTruthy tests are clean; only the
  // two conditional-test wrappers have no assertion.
  assert.equal(findings.length, 2);
  assert.ok(findings.every((finding) => finding.confidence === 'high'));
  assert.deepEqual(
    findings.map((finding) => finding.start.line).sort((a, b) => a - b),
    [16, 20],
  );
});

test('regression: a comment inside the try body does not excuse a bare except', async () => {
  const result = await scanFixture('regressions/try-comment');
  const swallowed = ruleFindings(result, 'py/swallowed-exception');
  assert.equal(swallowed.length, 1);
  assert.equal(swallowed[0]?.confidence, 'high');
});

test('regression: only exact no-op path segments are skipped', async () => {
  const result = await scanFixture('regressions/noop-overmatch');
  const stubs = ruleFindings(result, 'py/stub-body');
  assert.equal(stubs.length, 2);
  assert.ok(stubs.every((finding) => finding.confidence === 'high'));
  assert.deepEqual(
    stubs.map((finding) => finding.file).sort(),
    ['dummy_data/loader.py', 'shims/translate.py'],
  );
});

test('regression: test.each / it.concurrent / nested it are still analysed', async () => {
  const result = await scanFixture('regressions/test-call-forms');
  const findings = ruleFindings(result, 'ts/noop-test');
  assert.equal(findings.length, 3);
  assert.ok(findings.every((finding) => finding.confidence === 'high'));
});

test('regression: .js is counted as javascript, not tsx', async () => {
  const result = await scanFixture('regressions/js-jsx');
  assert.equal(result.stats.byLanguage.javascript, 1);
  assert.equal(result.stats.byLanguage.tsx, 0);
  assert.equal(result.stats.byLanguage.typescript, 0);
});
