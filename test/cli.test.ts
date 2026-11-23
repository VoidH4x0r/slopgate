import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
async function run(args: readonly string[], cwd = process.cwd()): Promise<CliResult> {
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
    cwd,
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
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown option: --nope/);
  assert.match(result.stderr, new RegExp(`slopgate ${pkg.version.replaceAll('.', '\\.')}`));
  assert.doesNotMatch(result.stderr, /slopgate 0\.1\.0 —/);
});

test('cli: empty value flags are rejected instead of silently ignored', async () => {
  for (const flag of ['--include=', '--exclude=', '--rule=', '--baseline=', '--write-baseline=']) {
    const result = await run([flag]);
    assert.equal(result.status, 2, flag);
    assert.match(result.stderr, /needs a (?:non-empty )?value|non-empty path/, flag);
  }
});

test('cli: --diff= falls back to HEAD', async () => {
  const result = await run(['fixtures/demo', '--diff=', '--no-color']);
  // Depending on whether the fixture is inside git, this reaches git or exits
  // with its error; either way it must not be rejected as an empty ref.
  assert.doesNotMatch(result.stderr, /empty git ref/);
});
test('cli: duplicate-block findings are visible at medium confidence', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-cli-duplicate-'));
  try {
    const body = [
      'def build(user):',
      '    payload = {}',
      '    payload["id"] = user.id',
      '    payload["name"] = user.name',
      '    if not user.active:',
      '        payload["active"] = False',
      '    return payload',
      '',
    ].join('\n');
    await writeFile(path.join(dir, 'a.py'), body);
    await writeFile(path.join(dir, 'b.py'), body.replace('build', 'build_again'));
    const result = await run([dir, '--format', 'json', '--confidence', 'medium', '--fail-on', 'medium']);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout) as {
      findings: Array<{ ruleId: string; confidence: string }>;
    };
    const duplicates = payload.findings.filter((finding) => finding.ruleId === 'py/duplicate-block');
    assert.equal(duplicates.length, 2);
    assert.ok(duplicates.every((finding) => finding.confidence === 'medium'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --fix applies safe unreachable edits and re-scans', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-cli-fix-'));
  try {
    await writeFile(path.join(dir, 'app.py'), 'def f():\n    return 1\n    print("dead")\n');
    const result = await run([dir, '--fix', '--no-color']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /fixed 1 finding/);
    assert.equal(await readFile(path.join(dir, 'app.py'), 'utf8'), 'def f():\n    return 1\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --fix-dry-run does not write and keeps machine output valid', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-cli-fix-dry-'));
  try {
    const original = 'def f():\n    return 1\n    print("dead")\n';
    await writeFile(path.join(dir, 'app.py'), original);
    const result = await run([dir, '--fix-dry-run', '--format', 'json']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /would fix 1 finding/);
    assert.equal(await readFile(path.join(dir, 'app.py'), 'utf8'), original);
    assert.doesNotThrow(() => JSON.parse(result.stdout));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --fix respects the baseline and leaves known findings untouched', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-cli-fix-baseline-'));
  try {
    const file = path.join(dir, 'app.py');
    await writeFile(file, 'def f():\n    return 1\n    print("dead")\n');
    const baseline = await run([dir, '--write-baseline', '--no-color']);
    assert.equal(baseline.status, 0, baseline.stderr);
    const original = await readFile(file, 'utf8');
    const result = await run([dir, '--fix', '--no-color']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /no safe fixes available/);
    assert.equal(await readFile(file, 'utf8'), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --fix with JSON still writes and emits valid JSON', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-cli-fix-json-'));
  try {
    await writeFile(path.join(dir, 'app.py'), 'def f():\n    return 1\n    print("dead")\n');
    const result = await run([dir, '--fix', '--format', 'json']);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotThrow(() => JSON.parse(result.stdout));
    assert.doesNotMatch(result.stdout, /dead/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --fix honours --rule and leaves other findings alone', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-cli-fix-rule-'));
  try {
    const file = path.join(dir, 'app.py');
    await writeFile(file, 'import missing_sdk\n\ndef f():\n    return 1\n    print("dead")\n');
    const result = await run([dir, '--fix', '--rule', 'py/unreachable', '--no-color']);
    assert.equal(result.status, 0, result.stderr);
    const text = await readFile(file, 'utf8');
    assert.match(text, /import missing_sdk/);
    assert.doesNotMatch(text, /print\("dead"\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --fix supports SARIF output', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-cli-fix-sarif-'));
  try {
    await writeFile(path.join(dir, 'app.py'), 'def f():\n    return 1\n    print("dead")\n');
    const result = await run([dir, '--fix', '--format', 'sarif']);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as { version: string };
    assert.equal(payload.version, '2.1.0');
    assert.doesNotMatch(await readFile(path.join(dir, 'app.py'), 'utf8'), /dead/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --fix supports github output and quiet mode', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-cli-fix-github-'));
  try {
    await writeFile(path.join(dir, 'app.py'), 'def f():\n    return 1\n    print("dead")\n');
    const result = await run([dir, '--fix', '--format', 'github', '--quiet']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /::notice title=slopgate::/);
    assert.equal(result.stderr, '');
    assert.doesNotMatch(await readFile(path.join(dir, 'app.py'), 'utf8'), /dead/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --fix supports --confidence and --verbose', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-cli-fix-verbose-'));
  try {
    await writeFile(path.join(dir, 'app.py'), 'def f():\n    return 1\n    print("dead")\n');
    const result = await run([dir, '--fix', '--confidence', 'medium', '--verbose', '--no-color']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /fixed 1 finding/);
    assert.match(result.stdout, /config:/);
    assert.doesNotMatch(await readFile(path.join(dir, 'app.py'), 'utf8'), /dead/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --fix with --diff fixes findings on changed lines', async () => {
  const dir = await mkdtemp(path.join(ROOT, '.tmp-fix-diff-'));
  try {
    await writeFile(path.join(dir, 'app.py'), 'def f():\n    return 1\n    print("dead")\n');
    const result = await run([dir, '--fix', '--diff=HEAD', '--no-color']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /fixed 1 finding/);
    assert.doesNotMatch(await readFile(path.join(dir, 'app.py'), 'utf8'), /dead/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --fix-dry-run works on a read-only file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-cli-fix-readonly-'));
  const file = path.join(dir, 'app.py');
  try {
    await writeFile(file, 'def f():\n    return 1\n    print("dead")\n');
    await chmod(file, 0o444);
    const result = await run([dir, '--fix-dry-run', '--no-color']);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /would fix 1 finding/);
    assert.match(await readFile(file, 'utf8'), /dead/);
  } finally {
    await chmod(file, 0o644).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --fix rejects --write-baseline', async () => {
  const result = await run(['fixtures/demo', '--fix', '--write-baseline']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot be combined/);
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
  assert.match(result.stderr, /16 rule ids/);
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

test('cli: a subdirectory --write-baseline preserves the root baseline', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-baseline-merge-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'a.py'), 'def root_stub():\n    pass\n');
    await writeFile(path.join(dir, 'src', 'b.py'), 'def src_stub():\n    pass\n');

    const rootWrite = await run([dir, '--write-baseline', '--no-color']);
    assert.equal(rootWrite.status, 0, rootWrite.stderr);
    const srcWrite = await run([path.join(dir, 'src'), '--write-baseline', '--no-color']);
    assert.equal(srcWrite.status, 0, srcWrite.stderr);

    const scan = await run([dir, '--no-color']);
    assert.equal(scan.status, 0, scan.stderr);
    assert.match(scan.stdout, /hidden: 2 in baseline/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('cli: --write-baseline replaces scanned entries and prunes deleted files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-baseline-prune-'));
  try {
    await writeFile(path.join(dir, 'a.py'), 'def a():\n    pass\n');
    await writeFile(path.join(dir, 'b.py'), 'def b():\n    pass\n');
    assert.equal((await run([dir, '--write-baseline', '--no-color'])).status, 0);
    await rm(path.join(dir, 'b.py'));

    const rewritten = await run([dir, '--write-baseline', '--no-color']);
    assert.equal(rewritten.status, 0, rewritten.stderr);
    const baseline = JSON.parse(
      await readFile(path.join(dir, '.slopgate-baseline.json'), 'utf8'),
    ) as { entries: Array<{ file: string }> };
    assert.deepEqual(baseline.entries.map((entry) => entry.file), ['a.py']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

test('cli: --strict on a scan warns that it only affects init', async () => {
  const result = await run(['fixtures/clean', '--strict', '--no-color']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /--strict only affects `init`/);
});

test('cli: init --strict writes medium confidence and fail-on into config and workflow', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-init-strict-'));
  try {
    await mkdir(path.join(dir, '.git'));
    const result = await run(['init', dir, '--strict']);
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(
      await readFile(path.join(dir, '.slopgate.json'), 'utf8'),
    ) as { confidence: string; failOn: string };
    assert.equal(config.confidence, 'medium');
    assert.equal(config.failOn, 'medium');
    const workflow = await readFile(
      path.join(dir, '.github', 'workflows', 'slopgate.yml'),
      'utf8',
    );
    assert.match(workflow, /--confidence medium --fail-on medium/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: init pins the current version instead of writing @latest', async () => {
  const dir = await mkdtemp(path.join(ROOT, 'test', '.tmp-init-'));
  try {
    await mkdir(path.join(dir, '.git'));
    const result = await run(['init', dir]);
    assert.equal(result.status, 0, result.stderr);
    const workflow = await readFile(path.join(dir, '.github', 'workflows', 'slopgate.yml'), 'utf8');
    assert.match(workflow, /@\d+\.\d+\.\d+ \. --fail-on high/);
    assert.ok(!workflow.includes('@latest'), 'the generated workflow must be reproducible');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: the nearest package config wins over the repo-root config', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-monorepo-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'packages', 'app'), { recursive: true });
    await writeFile(
      path.join(dir, '.slopgate.json'),
      '{"rules":{"py/stub-body":"error"}}',
    );
    await writeFile(
      path.join(dir, 'packages', 'app', '.slopgate.json'),
      '{"rules":{"py/stub-body":"off"}}',
    );
    await writeFile(path.join(dir, 'packages', 'app', 'app.py'), 'def stubbed():\n    pass\n');

    const packageScan = await run([path.join(dir, 'packages', 'app'), '--format', 'json']);
    assert.equal(packageScan.status, 0, packageScan.stderr);
    assert.deepEqual((JSON.parse(packageScan.stdout) as { findings: unknown[] }).findings, []);

    const rootScan = await run([dir, '--format', 'json']);
    assert.equal(rootScan.status, 1, rootScan.stderr);
    const rootPayload = JSON.parse(rootScan.stdout) as {
      findings: Array<{ severity: string }>;
    };
    assert.ok(rootPayload.findings.some((finding) => finding.severity === 'error'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: init writes the config at the requested package and the workflow at the root', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-init-package-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'packages', 'app'), { recursive: true });
    const result = await run(['init', path.join(dir, 'packages', 'app')]);
    assert.equal(result.status, 0, result.stderr);
    await readFile(path.join(dir, 'packages', 'app', '.slopgate.json'), 'utf8');
    const workflow = await readFile(
      path.join(dir, '.github', 'workflows', 'slopgate.yml'),
      'utf8',
    );
    assert.match(workflow, /\/packages\/app|\.\/packages\/app/);
    await assert.rejects(
      readFile(path.join(dir, 'packages', 'app', '.github', 'workflows', 'slopgate.yml'), 'utf8'),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: init from a subdirectory writes at the repository root', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-init-root-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'src'));
    const result = await run(['init', path.join(dir, 'src')]);
    assert.equal(result.status, 0, result.stderr);
    await readFile(path.join(dir, 'src', '.slopgate.json'), 'utf8');
    const workflow = await readFile(
      path.join(dir, '.github', 'workflows', 'slopgate.yml'),
      'utf8',
    );
    assert.match(workflow, /\.\/src/);
    await assert.rejects(
      readFile(path.join(dir, 'src', '.github', 'workflows', 'slopgate.yml'), 'utf8'),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: config globs are project-root-relative for subdirectory and file scans', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-config-globs-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'src', 'generated'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'app.py'), 'def stubbed():\n    pass\n');
    await writeFile(path.join(dir, 'src', 'generated', 'g.py'), 'def generated_stub():\n    pass\n');

    await writeFile(path.join(dir, '.slopgate.json'), '{"include":["src/app.py"]}\n');
    const directory = await run([path.join(dir, 'src'), '--no-color']);
    assert.equal(directory.status, 1, directory.stderr);
    assert.match(directory.stdout, /^src\/app\.py$/m);
    assert.doesNotMatch(directory.stdout, /generated\/g\.py/);

    const single = await run([path.join(dir, 'src', 'app.py'), '--no-color']);
    assert.equal(single.status, 1, single.stderr);
    assert.match(single.stdout, /^src\/app\.py$/m);

    await writeFile(path.join(dir, '.slopgate.json'), '{"exclude":["src/generated/**"]}\n');
    const excluded = await run([path.join(dir, 'src'), '--no-color']);
    assert.equal(excluded.status, 1, excluded.stderr);
    assert.doesNotMatch(excluded.stdout, /generated\/g\.py/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: a root config still governs a child package with its own manifest', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-config-child-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'backend', 'generated'), { recursive: true });
    await writeFile(
      path.join(dir, 'backend', 'pyproject.toml'),
      '[project]\nname = "backend"\nversion = "0.0.0"\ndependencies = []\n',
    );
    await writeFile(path.join(dir, 'backend', 'app.py'), 'def stubbed():\n    pass\n');
    await writeFile(
      path.join(dir, 'backend', 'generated', 'g.py'),
      'def generated_stub():\n    pass\n',
    );
    await writeFile(path.join(dir, '.slopgate.json'), '{"include":["backend/app.py"]}\n');
    const included = await run([path.join(dir, 'backend'), '--no-color']);
    assert.equal(included.status, 1, included.stderr);
    assert.match(included.stdout, /^backend\/app\.py$/m);
    assert.doesNotMatch(included.stdout, /generated\/g\.py/);

    await writeFile(path.join(dir, '.slopgate.json'), '{"exclude":["backend/generated/**"]}\n');
    const excluded = await run([path.join(dir, 'backend'), '--no-color']);
    assert.equal(excluded.status, 1, excluded.stderr);
    assert.doesNotMatch(excluded.stdout, /generated\/g\.py/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: a monorepo root scan uses the nearest project manifest', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-monorepo-root-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'backend'), { recursive: true });
    await writeFile(
      path.join(dir, 'backend', 'pyproject.toml'),
      '[project]\nname = "backend"\nversion = "0.0.0"\ndependencies = ["django"]\n',
    );
    await writeFile(path.join(dir, 'backend', 'app.py'), 'import django\n');

    const root = await run([dir, '--no-color']);
    assert.equal(root.status, 0, root.stderr);
    assert.doesNotMatch(root.stdout, /phantom-import/);

    const backend = await run([path.join(dir, 'backend'), '--no-color']);
    assert.equal(backend.status, 0, backend.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --exclude is relative to the project when no config file exists', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-exclude-noconfig-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'packages', 'app', 'generated'), { recursive: true });
    await writeFile(
      path.join(dir, 'packages', 'app', 'package.json'),
      '{"name":"app","private":true}\n',
    );
    await writeFile(path.join(dir, 'packages', 'app', 'app.py'), 'def stubbed():\n    pass\n');
    await writeFile(
      path.join(dir, 'packages', 'app', 'generated', 'g.py'),
      'def generated_stub():\n    pass\n',
    );

    const result = await run([
      path.join(dir, 'packages', 'app'),
      '--exclude',
      'generated/**',
      '--no-color',
    ]);
    assert.equal(result.status, 1, result.stderr);
    assert.doesNotMatch(result.stdout, /generated\/g\.py/);
    assert.match(result.stdout, /^packages\/app\/app\.py$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: a nested package does not hide ancestor manifests or sibling modules', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-ancestor-index-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await mkdir(path.join(dir, 'packages', 'app'), { recursive: true });
    await mkdir(path.join(dir, 'lib'), { recursive: true });
    await writeFile(
      path.join(dir, 'pyproject.toml'),
      '[project]\nname = "root"\nversion = "0.0.0"\ndependencies = ["requests"]\n',
    );
    await writeFile(path.join(dir, 'assets', 'package.json'), '{"name":"assets","private":true}\n');
    await writeFile(path.join(dir, 'assets', 'build.py'), 'import requests\n');
    await writeFile(path.join(dir, 'lib', 'util.py'), 'def f():\n    return 1\n');
    await writeFile(path.join(dir, 'packages', 'app', 'package.json'), '{"name":"app","private":true}\n');
    await writeFile(path.join(dir, 'packages', 'app', 'app.py'), 'from lib.util import f\n');

    const assets = await run([path.join(dir, 'assets'), '--no-color']);
    assert.equal(assets.status, 0, assets.stderr);
    const app = await run([path.join(dir, 'packages', 'app'), '--no-color']);
    assert.equal(app.status, 0, app.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: a non-git package sees sibling modules from a workspace cwd', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-cwd-crosspkg-'));
  try {
    await mkdir(path.join(dir, 'project', 'lib'), { recursive: true });
    await mkdir(path.join(dir, 'project', 'packages', 'app'), { recursive: true });
    await writeFile(path.join(dir, 'project', 'lib', 'util.py'), 'def f():\n    return 1\n');
    await writeFile(
      path.join(dir, 'project', 'packages', 'app', 'pyproject.toml'),
      '[project]\nname = "app"\nversion = "0.0.0"\ndependencies = []\n',
    );
    await writeFile(
      path.join(dir, 'project', 'packages', 'app', 'app.py'),
      'from lib.util import f\n',
    );

    // cwd is the parent of the project root, so ancestor-chain indexing (not
    // just lookup-root indexing) is required to see project/lib. The relative
    // target also proves the CLI uses the injected cwd rather than process.cwd.
    const result = await run(['project/packages/app', '--no-color'], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /phantom-import/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: a subdirectory scan sees Python modules outside the target', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-local-modules-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await mkdir(path.join(dir, 'lib'), { recursive: true });
    await writeFile(
      path.join(dir, 'pyproject.toml'),
      '[project]\nname = "root"\nversion = "0.0.0"\ndependencies = []\n',
    );
    await writeFile(path.join(dir, 'lib', 'util.py'), 'def f():\n    return 1\n');
    await writeFile(path.join(dir, 'src', 'app.py'), 'from lib.util import f\n\nx = f()\n');

    const result = await run([path.join(dir, 'src'), '--no-color']);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /phantom-import/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: a nested package.json does not select the wrong language project', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-mixed-projects-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await writeFile(
      path.join(dir, 'pyproject.toml'),
      '[project]\nname = "root"\nversion = "0.0.0"\ndependencies = ["requests"]\n',
    );
    await writeFile(path.join(dir, 'assets', 'package.json'), '{"name":"assets","private":true}\n');
    await writeFile(path.join(dir, 'assets', 'build.py'), 'import requests\n');

    const result = await run([dir, '--no-color']);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /phantom-import/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: registry indexing respects config excludes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-registry-exclude-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await mkdir(path.join(dir, 'fixtures', 'x'), { recursive: true });
    await writeFile(
      path.join(dir, 'pyproject.toml'),
      '[project]\nname = "root"\nversion = "0.0.0"\ndependencies = []\n',
    );
    await writeFile(path.join(dir, 'fixtures', 'x', 'phantom_helper.py'), 'def f():\n    return 1\n');
    await writeFile(path.join(dir, 'src', 'app.py'), 'import phantom_helper\n');
    await writeFile(path.join(dir, '.slopgate.json'), '{"exclude":["fixtures/**"]}\n');

    const result = await run([path.join(dir, 'src'), '--no-color']);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /py\/phantom-import/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: nested requirements-dev.txt marks a Python project', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-python-marker-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'backend', 'src'), { recursive: true });
    await writeFile(path.join(dir, 'backend', 'requirements-dev.txt'), 'requests>=2\n');
    await writeFile(path.join(dir, 'backend', 'src', 'app.py'), 'import requests\n');

    const result = await run([path.join(dir, 'backend', 'src'), '--no-color']);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /phantom-import/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: Vite tsconfig.app paths provide aliases', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-vite-alias-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'src', 'ui'), { recursive: true });
    await writeFile(path.join(dir, 'package.json'), '{"name":"app","private":true}\n');
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      '{"files":[],"references":[{"path":"./tsconfig.app.json"}]}\n',
    );
    await writeFile(
      path.join(dir, 'tsconfig.app.json'),
      '{"compilerOptions":{"baseUrl":".","paths":{"@ui/*":["./src/ui/*"]}}}\n',
    );
    await writeFile(path.join(dir, 'src', 'ui', 'helper.ts'), 'export const value = 1;\n');
    await writeFile(path.join(dir, 'src', 'main.ts'), "import { value } from '@ui/helper';\nexport { value };\n");

    const result = await run([dir, '--no-color']);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /phantom-import/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: single-file and subdirectory scans use the repository project root', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-project-root-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(
      path.join(dir, 'pyproject.toml'),
      '[project]\nname = "root"\nversion = "0.0.0"\ndependencies = ["requests"]\n',
    );
    await writeFile(path.join(dir, 'src', 'util.py'), 'def helper():\n    return 1\n');
    await writeFile(
      path.join(dir, 'src', 'app.py'),
      'import requests\nfrom util import helper\n\ndef stubbed():\n    pass\n',
    );
    await writeFile(
      path.join(dir, 'package.json'),
      '{"name":"root","private":true,"dependencies":{}}\n',
    );
    await writeFile(path.join(dir, 'src', 'agent.ts'), "import { x } from 'ghost';\nexport const y = x;\n");

    const single = await run([path.join(dir, 'src', 'app.py'), '--no-color']);
    assert.equal(single.status, 1, single.stderr);
    assert.match(single.stdout, /^src\/app\.py$/m);
    assert.doesNotMatch(single.stdout, /not declared/);
    assert.match(single.stdout, /py\/stub-body/);

    const directory = await run([path.join(dir, 'src'), '--no-color']);
    assert.equal(directory.status, 1, directory.stderr);
    assert.match(directory.stdout, /^src\/app\.py$/m);
    assert.doesNotMatch(directory.stdout, /not declared/);
    assert.match(directory.stdout, /ts\/phantom-import/);
    assert.match(directory.stdout, /^src\/agent\.ts$/m);
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

test('cli: baseline keys work across root, directory and file targets', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-mixed-baseline-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'src'));
    await writeFile(path.join(dir, 'src', 'a.py'), 'def stubbed():\n    pass\n');

    const rootWrite = await run([dir, '--write-baseline']);
    assert.equal(rootWrite.status, 0, rootWrite.stderr);
    const fileRead = await run([path.join(dir, 'src', 'a.py'), '--format', 'json']);
    assert.equal(fileRead.status, 0, fileRead.stderr);
    const filePayload = JSON.parse(fileRead.stdout) as {
      findings: unknown[];
      summary: { baselined: number };
    };
    assert.deepEqual(filePayload.findings, []);
    assert.equal(filePayload.summary.baselined, 1);

    await rm(path.join(dir, '.slopgate-baseline.json'), { force: true });
    const dirWrite = await run([path.join(dir, 'src'), '--write-baseline']);
    assert.equal(dirWrite.status, 0, dirWrite.stderr);
    const rootRead = await run([dir, '--format', 'json']);
    assert.equal(rootRead.status, 0, rootRead.stderr);
    const rootPayload = JSON.parse(rootRead.stdout) as {
      findings: unknown[];
      summary: { baselined: number };
    };
    assert.deepEqual(rootPayload.findings, []);
    assert.equal(rootPayload.summary.baselined, 1);
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
