import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { main } from '../src/cli.ts';
import { ROOT } from './helpers.ts';

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the CLI in-process with an injected output collector. Never patches
 * process.stdout: Node's test runner uses stdout for its own protocol when
 * test files run in separate processes (the default), and capturing it there
 * corrupts the report.
 */
async function run(args: readonly string[]): Promise<CliResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const status = await main(args, {
    out: (text) => {
      stdoutChunks.push(text);
    },
    err: (text) => {
      stderrChunks.push(text);
    },
    isTTY: false,
  });
  return { status, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
}

test('cli: json output exits 1 when findings exist', async () => {
  const result = await run(['fixtures/demo', '--format', 'json']);
  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout) as { tool: string; findings: unknown[] };
  assert.equal(payload.tool, 'slopgate');
  assert.ok(payload.findings.length > 0);
});

test('cli: clean fixture exits 0', async () => {
  const result = await run(['fixtures/clean', '--no-color']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no findings/);
});

test('cli: --fail-on none exits 0 even with findings', async () => {
  const result = await run(['fixtures/demo', '--fail-on', 'none', '--no-color']);
  assert.equal(result.status, 0, result.stderr);
});

test('cli: --version prints the package version', async () => {
  const result = await run(['--version']);
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('cli: rules lists every rule id', async () => {
  const result = await run(['rules']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /py\/phantom-import/);
  assert.match(result.stdout, /ts\/stub-function/);
});

test('cli: unknown options exit 2 with a helpful message', async () => {
  const result = await run(['fixtures/demo', '--nope']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown option: --nope/);
});

test('cli: a missing path exits 2 instead of silently scanning nothing', async () => {
  const result = await run(['this-path-does-not-exist-42']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /path not found/);
});

test('cli: more than one path is rejected instead of silently ignored', async () => {
  const result = await run(['fixtures/demo', 'fixtures/clean']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /only one path is supported/);
});

test('cli: an unknown --rule id exits 2 and lists the rule count', async () => {
  const result = await run(['fixtures/demo', '--rule', 'py/nope']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown rule id: py\/nope/);
  assert.match(result.stderr, /14 rule ids/);
});

test('cli: confidence filter hides medium findings', async () => {
  const result = await run(['fixtures/demo', '--format', 'json', '--confidence', 'high']);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout) as { findings: Array<{ confidence: string }> };
  assert.ok(payload.findings.length > 0);
  assert.ok(payload.findings.every((finding) => finding.confidence === 'high'));
});

test('cli: sarif output is machine readable', async () => {
  const result = await run(['fixtures/demo', '--format', 'sarif']);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout) as { version: string; runs: unknown[] };
  assert.equal(payload.version, '2.1.0');
  assert.equal(payload.runs.length, 1);
});

test('cli: github annotations are emitted and the exit code is honoured', async () => {
  const failing = await run(['fixtures/demo', '--format', 'github']);
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /^::error file=/m);
  assert.match(failing.stdout, /^::notice title=slopgate::/m);

  const passing = await run(['fixtures/demo', '--format', 'github', '--fail-on', 'none']);
  assert.equal(passing.status, 0);
});

test('cli: an explicitly requested baseline that does not exist exits 2', async () => {
  const result = await run(['fixtures/demo', '--baseline', 'no-such-baseline.json']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /baseline file not found/);
});

test('cli: scanning zero files exits 2 instead of reporting a clean run', async () => {
  const dir = await mkdtemp(path.join(ROOT, 'test', '.tmp-empty-'));
  try {
    const result = await run([dir, '--no-color']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no files matched/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: a config value from Object.prototype is rejected', async () => {
  const result = await run(['fixtures/regressions/cfg', '--no-color']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /confidence/);
});

test('cli: an unknown rule id in config exits 2 even with --quiet', async () => {
  const result = await run(['fixtures/regressions/bad-rule-config', '--quiet', '--no-color']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown rule in config: py\/does-not-exist/);
});

test('cli: --include appends to the default pattern set', async () => {
  const result = await run([
    'fixtures/regressions/include-semantics',
    '--include',
    'src/**',
    '--format',
    'json',
    '--fail-on',
    'none',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as { stats: { files: number } };
  assert.equal(payload.stats.files, 3);
});

test('cli: --verbose shows the effective include count', async () => {
  const result = await run([
    'fixtures/regressions/include-semantics',
    '--include',
    'src/**',
    '--verbose',
    '--no-color',
    '--fail-on',
    'none',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /include: 11 pattern\(s\)/);
});

test('cli: --fail-on medium lowers the display threshold and fails the run', async () => {
  const result = await run(['fixtures/regressions/failon', '--fail-on', 'medium', '--format', 'json']);
  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout) as {
    findings: Array<{ ruleId: string; confidence: string }>;
  };
  assert.equal(payload.findings.length, 1);
  assert.equal(payload.findings[0]?.ruleId, 'ts/swallowed-exception');
  assert.equal(payload.findings[0]?.confidence, 'medium');
});

test('cli: init pins the current version instead of writing @latest', async () => {
  const dir = await mkdtemp(path.join(ROOT, 'test', '.tmp-init-'));
  try {
    const result = await run(['init', dir]);
    assert.equal(result.status, 0, result.stderr);
    const workflow = await readFile(path.join(dir, '.github', 'workflows', 'slopgate.yml'), 'utf8');
    assert.match(workflow, /@\d+\.\d+\.\d+ \. --fail-on high/);
    assert.ok(!workflow.includes('@latest'), 'the generated workflow must be reproducible');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: a diff ref that looks like a git option is rejected before git runs', async () => {
  const result = await run(['fixtures/demo', '--diff=--output=pwned.txt']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid git ref/);
});

test('cli: mcp refuses a root that is not a directory', async () => {
  const result = await run(['mcp', 'fixtures/demo/app.py']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /MCP root is not a directory/);
});

test('cli: a single file argument scans just that file', async () => {
  const result = await run(['fixtures/demo/app.py', '--format', 'json']);
  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout) as {
    stats: { files: number };
    findings: Array<{ file: string }>;
  };
  assert.equal(payload.stats.files, 1);
  assert.ok(payload.findings.length > 0);
  assert.ok(payload.findings.every((finding) => finding.file === 'app.py'));
});

test('cli: --rule restricts the run to one rule', async () => {
  const result = await run(['fixtures/demo', '--format', 'json', '--rule', 'py/phantom-import']);
  const payload = JSON.parse(result.stdout) as { findings: Array<{ ruleId: string }> };
  assert.ok(payload.findings.length > 0);
  assert.ok(payload.findings.every((finding) => finding.ruleId === 'py/phantom-import'));
});
