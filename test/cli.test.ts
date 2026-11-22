import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-cfg-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await writeFile(path.join(dir, '.slopgate.json'), '{"confidence":"toString"}');
    await writeFile(path.join(dir, 'app.py'), 'def f():\n    pass\n');
    const result = await run([dir, '--no-color']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /confidence/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: an unknown rule id in config exits 2 even with --quiet', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-bad-rule-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await writeFile(
      path.join(dir, '.slopgate.json'),
      '{"rules":{"py/does-not-exist":"off"}}',
    );
    await writeFile(path.join(dir, 'app.py'), 'def f():\n    pass\n');
    const result = await run([dir, '--quiet', '--no-color']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown rule in config: py\/does-not-exist/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-single-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'src'));
    await writeFile(path.join(dir, 'src', 'app.py'), 'def root_stub():\n    pass\n');
    const result = await run([path.join(dir, 'src', 'app.py'), '--format', 'json']);
    assert.equal(result.status, 1, result.stderr);
    const payload = JSON.parse(result.stdout) as {
      stats: { files: number };
      findings: Array<{ file: string }>;
    };
    assert.equal(payload.stats.files, 1);
    assert.ok(payload.findings.length > 0);
    assert.ok(payload.findings.every((finding) => finding.file === 'src/app.py'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: reports from a subdirectory use repo-relative paths', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-paths-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'src'));
    await writeFile(path.join(dir, 'src', 'a.py'), 'def root_stub():\n    pass\n');
    const target = path.join(dir, 'src');

    const json = await run([target, '--format', 'json', '--fail-on', 'none']);
    assert.equal(json.status, 0, json.stderr);
    const payload = JSON.parse(json.stdout) as { findings: Array<{ file: string }> };
    assert.ok(payload.findings.length > 0);
    assert.ok(payload.findings.every((finding) => finding.file === 'src/a.py'));

    const sarif = await run([target, '--format', 'sarif', '--fail-on', 'none']);
    assert.equal(sarif.status, 0, sarif.stderr);
    const sarifPayload = JSON.parse(sarif.stdout) as {
      runs: Array<{ results: Array<{ locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }> }> }>;
    };
    assert.equal(sarifPayload.runs[0]?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri, 'src/a.py');

    const github = await run([target, '--format', 'github', '--fail-on', 'none']);
    assert.equal(github.status, 0, github.stderr);
    assert.match(github.stdout, /file=src\/a\.py/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: repository-root config applies to subdirectory and file scans', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-root-config-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'src'));
    await writeFile(
      path.join(dir, '.slopgate.json'),
      '{"rules":{"py/stub-body":"off"}}',
    );
    await writeFile(path.join(dir, 'src', 'a.py'), 'def stubbed():\n    pass\n');

    for (const target of [dir, path.join(dir, 'src'), path.join(dir, 'src', 'a.py')]) {
      const result = await run([target, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as { findings: unknown[] };
      assert.deepEqual(payload.findings, []);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: the default baseline is written and read at the repository root', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-root-baseline-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'src'));
    await writeFile(path.join(dir, 'src', 'a.py'), 'def stubbed():\n    pass\n');

    const write = await run([path.join(dir, 'src'), '--write-baseline']);
    assert.equal(write.status, 0, write.stderr);
    await readFile(path.join(dir, '.slopgate-baseline.json'), 'utf8');
    await assert.rejects(readFile(path.join(dir, 'src', '.slopgate-baseline.json'), 'utf8'));

    const rerun = await run([path.join(dir, 'src'), '--format', 'json']);
    assert.equal(rerun.status, 0, rerun.stderr);
    const payload = JSON.parse(rerun.stdout) as {
      findings: unknown[];
      summary: { baselined: number };
    };
    assert.deepEqual(payload.findings, []);
    assert.equal(payload.summary.baselined, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: severity info stays visible but still fails CI', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-severity-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await writeFile(
      path.join(dir, '.slopgate.json'),
      '{"rules":{"py/stub-body":"info"}}',
    );
    await writeFile(path.join(dir, 'app.py'), 'def stubbed():\n    pass\n');
    const result = await run([dir, '--format', 'json']);
    assert.equal(result.status, 1, result.stderr);
    const payload = JSON.parse(result.stdout) as { findings: Array<{ severity: string }> };
    assert.ok(payload.findings.some((finding) => finding.severity === 'info'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --rule restricts the run to one rule', async () => {
  const result = await run(['fixtures/demo', '--format', 'json', '--rule', 'py/phantom-import']);
  const payload = JSON.parse(result.stdout) as { findings: Array<{ ruleId: string }> };
  assert.ok(payload.findings.length > 0);
  assert.ok(payload.findings.every((finding) => finding.ruleId === 'py/phantom-import'));
});
