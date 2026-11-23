import assert from 'node:assert/strict';
import test from 'node:test';
import { scanFixture } from './helpers.ts';

test('Go review fixture covers switch cases, build tags, generated files and test helpers', async () => {
  const result = await scanFixture('go-review');
  const unreachable = result.findings.filter((finding) => finding.ruleId === 'go/unreachable');
  assert.equal(unreachable.length, 1);
  assert.equal(unreachable[0]?.file, 'main.go');
  assert.equal(result.findings.filter((finding) => finding.ruleId === 'go/stub-body').length, 0);
  assert.equal(result.findings.filter((finding) => finding.ruleId === 'go/noop-test').length, 0);
});

test('Rust review fixture scans src/bin and accepts aliases/workspace/target deps', async () => {
  const result = await scanFixture('rust-review');
  assert.ok(result.files.includes('src/bin/tool.rs'));
  const unreachable = result.findings.filter((finding) => finding.ruleId === 'rs/unreachable');
  assert.equal(unreachable.length, 1);
  assert.equal(unreachable[0]?.file, 'src/bin/tool.rs');
  assert.equal(result.findings.filter((finding) => finding.ruleId === 'rs/stub-body').length, 0);
  assert.equal(result.findings.filter((finding) => finding.ruleId === 'rs/phantom-import').length, 0);
});
