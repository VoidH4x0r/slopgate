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

test('regression: all four comment placements behave as documented', async () => {
  const result = await scanFixture('regressions/window');
  const swallowed = ruleFindings(result, 'py/swallowed-exception');
  assert.equal(swallowed.length, 4);
  const high = swallowed.filter((finding) => finding.confidence === 'high');
  assert.equal(high.length, 1);
  assert.equal(high[0]?.start.line, 7, 'only the trailing try-body comment stays high');
  assert.equal(swallowed.filter((finding) => finding.confidence === 'medium').length, 3);
});

test('regression: renamed node:assert imports count as assertions', async () => {
  const result = await scanFixture('regressions/renamed-assert');
  assert.deepEqual(ruleFindings(result, 'ts/noop-test'), []);
});

test('regression: dummy_threading-style modules are skipped', async () => {
  const result = await scanFixture('regressions/dummy-variants');
  assert.deepEqual(ruleFindings(result, 'py/stub-body'), []);
});

test('regression: tape assertions count, the assertion-free test still reports', async () => {
  const result = await scanFixture('regressions/tape-assert');
  const findings = ruleFindings(result, 'ts/noop-test');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.start.line, 13);
});

test('regression: hoisted function declarations are not unreachable', async () => {
  const result = await scanFixture('regressions/hoisted-fn');
  const findings = ruleFindings(result, 'ts/unreachable');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.start.line, 16);
});

test('regression: named and require-bound node:assert imports count', async () => {
  const result = await scanFixture('regressions/assert-forms');
  assert.deepEqual(ruleFindings(result, 'ts/noop-test'), []);
});

test('regression: above-try comments need explanation wording', async () => {
  const result = await scanFixture('regressions/above-heuristic');
  const findings = ruleFindings(result, 'py/swallowed-exception');
  assert.equal(findings.length, 5);
  assert.equal(findings.filter((finding) => finding.confidence === 'medium').length, 3);
  assert.equal(findings.filter((finding) => finding.confidence === 'high').length, 2);
});

test('regression: trailing comments on the preceding code line do not demote', async () => {
  const result = await scanFixture('regressions/above-trailing');
  const findings = ruleFindings(result, 'py/swallowed-exception');
  assert.equal(findings.length, 2);
  assert.ok(findings.every((finding) => finding.confidence === 'high'));
});

test('regression: a TODO between try and except does not demote', async () => {
  const result = await scanFixture('regressions/between-asymmetry');
  const findings = ruleFindings(result, 'py/swallowed-exception');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.confidence, 'high');
});

test('regression: prefixed dummy directories with a shim docstring are skipped', async () => {
  const result = await scanFixture('regressions/dummy-dir-shim');
  assert.deepEqual(ruleFindings(result, 'py/stub-body'), []);
});

test('regression: delegated assertions are medium, not high', async () => {
  const result = await scanFixture('regressions/delegated-assert');
  const findings = ruleFindings(result, 'ts/noop-test');
  assert.equal(findings.length, 2);
  assert.ok(findings.every((finding) => finding.confidence === 'medium'));
});

test('regression: type-only declarations after return are not unreachable', async () => {
  const result = await scanFixture('regressions/ts-type-after-return');
  const findings = ruleFindings(result, 'ts/unreachable');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.start.line, 15);
});

test('regression: cleanup wording is a valid explanation', async () => {
  const result = await scanFixture('regressions/cleanup-word');
  const swallowed = ruleFindings(result, 'py/swallowed-exception');
  assert.equal(swallowed.length, 2);
  assert.ok(swallowed.every((finding) => finding.confidence === 'medium'));
});

test('regression: comments on the except line and in the handler count', async () => {
  const result = await scanFixture('regressions/comment-placement');
  const findings = ruleFindings(result, 'py/swallowed-exception');
  assert.equal(findings.length, 4);
  assert.ok(findings.every((finding) => finding.confidence === 'medium'));
});

test('regression: above-try wording stays conservative without an intent word', async () => {
  const result = await scanFixture('regressions/wording');
  const findings = ruleFindings(result, 'py/swallowed-exception');
  assert.equal(findings.length, 3);
  assert.equal(findings.filter((finding) => finding.confidence === 'high').length, 1);
  assert.equal(findings.find((finding) => finding.confidence === 'high')?.start.line, 16);
});

test('regression: future-work comments are noise, cleanup explanations are not', async () => {
  const result = await scanFixture('regressions/noise');
  const findings = ruleFindings(result, 'py/swallowed-exception');
  assert.equal(findings.length, 3);
  const high = findings.filter((finding) => finding.confidence === 'high');
  assert.deepEqual(
    high.map((finding) => finding.start.line).sort((a, b) => a - b),
    [7, 22],
  );
  assert.equal(findings.find((finding) => finding.start.line === 14)?.confidence, 'medium');
});

test('regression: a test delegating to a local assert helper is medium', async () => {
  const result = await scanFixture('regressions/py-named-helper');
  const findings = ruleFindings(result, 'py/noop-test');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.confidence, 'medium');
  assert.equal(findings[0]?.start.line, 9);
});

test('regression: verify-named Python delegation stays clean', async () => {
  const result = await scanFixture('regressions/py-delegated');
  const findings = ruleFindings(result, 'py/noop-test');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.start.line, 12);
  assert.equal(findings[0]?.confidence, 'high');
});

test('regression: explanations containing future words still demote', async () => {
  const result = await scanFixture('regressions/future-words');
  const findings = ruleFindings(result, 'py/swallowed-exception');
  assert.equal(findings.length, 3);
  const high = findings.filter((finding) => finding.confidence === 'high');
  assert.deepEqual(
    high.map((finding) => finding.start.line),
    [26],
  );
  assert.deepEqual(
    findings
      .filter((finding) => finding.confidence === 'medium')
      .map((finding) => finding.start.line)
      .sort((a, b) => a - b),
    [10, 18],
  );
});

test('regression: exception bindings do not narrow the caught type', async () => {
  const result = await scanFixture('regressions/as-binding');
  const findings = ruleFindings(result, 'py/swallowed-exception');
  assert.equal(findings.length, 4);
  assert.ok(findings.every((finding) => finding.confidence === 'high'));
});

test('regression: except* and tuple bindings classify by the caught type', async () => {
  const result = await scanFixture('regressions/as-binding-more');
  const findings = ruleFindings(result, 'py/swallowed-exception');
  assert.equal(findings.length, 4);
  assert.equal(findings.filter((finding) => finding.confidence === 'high').length, 3);
  const specific = findings.filter((finding) => finding.confidence === 'medium');
  assert.equal(specific.length, 1);
  assert.match(specific[0]?.message ?? '', /specific error type/);
});
