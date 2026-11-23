import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { scanProject } from '../src/engine.ts';

const BODY = [
  'def compute(values):',
  '    total = 0',
  '    for value in values:',
  '        total += value',
  '    total = total * 2',
  '    total = total + 1',
  '    if total < 0:',
  '        raise ValueError("negative")',
  '    return total',
  '',
].join('\n');

async function scanTwoFiles(
  left: string,
  right: string,
  options: { names?: [string, string]; onlyRules?: string[]; rules?: Record<string, string>; confidence?: 'high' | 'medium' | 'low' } = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-duplicates-'));
  try {
    await mkdir(path.join(dir, 'pkg'));
    const [leftName, rightName] = options.names ?? ['pkg/a.py', 'pkg/b.py'];
    await mkdir(path.dirname(path.join(dir, leftName)), { recursive: true });
    await mkdir(path.dirname(path.join(dir, rightName)), { recursive: true });
    await writeFile(path.join(dir, leftName), left, 'utf8');
    await writeFile(path.join(dir, rightName), right, 'utf8');
    return await scanProject({
      root: dir,
      config: {
        ...DEFAULT_CONFIG,
        include: ['**/*.py'],
        exclude: [],
        confidence: options.confidence ?? 'high',
        rules: (options.rules ?? {}) as never,
      },
      ...(options.onlyRules ? { onlyRules: new Set(options.onlyRules) } : {}),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('duplicate-block reports both sides of a cross-file normalized clone', async () => {
  const result = await scanTwoFiles(BODY, BODY.replace('total = 0', 'total = 0  # same body'));
  const duplicates = result.findings.filter((finding) => finding.ruleId === 'py/duplicate-block');
  assert.equal(duplicates.length, 2);
  assert.ok(duplicates.every((finding) => finding.confidence === 'medium'));
  assert.ok(duplicates.every((finding) => finding.evidence.some((item) => item.startsWith('also at:'))));
});

test('semantic-duplicate reports renamed clones but not exact clones', async () => {
  const renamed = [
    'def compute(items):',
    '    acc = 0',
    '    for item in items:',
    '        acc += item',
    '    acc = acc * 2',
    '    acc = acc + 1',
    '    if acc < 0:',
    '        raise ValueError("negative")',
    '    return acc',
    '',
  ].join('\n');
  const semantic = await scanTwoFiles(BODY, renamed, {
    onlyRules: ['py/semantic-duplicate'],
    confidence: 'medium',
  });
  assert.equal(
    semantic.findings.filter((finding) => finding.ruleId === 'py/semantic-duplicate').length,
    2,
  );

  const exact = await scanTwoFiles(BODY, BODY, {
    onlyRules: ['py/semantic-duplicate'],
    confidence: 'medium',
  });
  assert.equal(
    exact.findings.filter((finding) => finding.ruleId === 'py/semantic-duplicate').length,
    0,
  );
});

test('duplicate-block ignores short bodies, same-file copies and test paths', async () => {
  const short = 'def f():\n    return 1\n';
  assert.equal(
    (await scanTwoFiles(short, short)).findings.filter((f) => f.ruleId === 'py/duplicate-block').length,
    0,
  );

  const same = `${BODY}\n${BODY.replace('compute', 'compute_again')}\n`;
  assert.equal(
    (await scanTwoFiles(same, 'def unrelated():\n    return 0\n')).findings.filter(
      (f) => f.ruleId === 'py/duplicate-block',
    ).length,
    0,
  );

  assert.equal(
    (
      await scanTwoFiles(BODY, BODY, {
        names: ['tests/test_a.py', 'tests/test_b.py'],
      })
    ).findings.filter((f) => f.ruleId === 'py/duplicate-block').length,
    0,
  );
});

test('duplicate-block requires exact normalized tokens, not renamed variables', async () => {
  const renamed = BODY.replaceAll('values', 'items').replaceAll('value', 'item');
  const result = await scanTwoFiles(BODY, renamed);
  assert.equal(result.findings.filter((f) => f.ruleId === 'py/duplicate-block').length, 0);
});

test('duplicate-block supports config off, onlyRules and suppression', async () => {
  const off = await scanTwoFiles(BODY, BODY, { rules: { 'py/duplicate-block': 'off' } });
  assert.equal(off.findings.filter((f) => f.ruleId === 'py/duplicate-block').length, 0);

  const only = await scanTwoFiles(BODY, BODY, { onlyRules: ['py/duplicate-block'] });
  assert.equal(only.findings.filter((f) => f.ruleId === 'py/duplicate-block').length, 2);
  assert.ok(only.findings.every((f) => f.ruleId === 'py/duplicate-block'));

  const suppressed = await scanTwoFiles(
    `# slopgate-disable-file\n${BODY}`,
    BODY,
  );
  assert.equal(suppressed.findings.filter((f) => f.ruleId === 'py/duplicate-block').length, 1);
});

test('duplicate-block finds TypeScript function bodies', async () => {
  const body = [
    'export function compute(values: number[]): number {',
    '  let total = 0;',
    '  for (const value of values) {',
    '    total += value;',
    '  }',
    '  total = total * 2;',
    '  total = total + 1;',
    '  if (total < 0) {',
    '    throw new Error("negative");',
    '  }',
    '  return total;',
    '}',
    '',
  ].join('\n');
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-duplicates-ts-'));
  try {
    await writeFile(path.join(dir, 'a.ts'), body, 'utf8');
    await writeFile(path.join(dir, 'b.ts'), body.replace('compute', 'computeOther'), 'utf8');
    const result = await scanProject({
      root: dir,
      config: { ...DEFAULT_CONFIG, include: ['**/*.ts'], exclude: [] },
    });
    assert.equal(result.findings.filter((f) => f.ruleId === 'ts/duplicate-block').length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('duplicate-block treats operators as part of the signature', async () => {
  const changed = BODY.replace('total += value', 'total -= value')
    .replace('total = total * 2', 'total = total / 2')
    .replace('total = total + 1', 'total = total - 1')
    .replace('if total < 0', 'if total > 0');
  const result = await scanTwoFiles(BODY, changed);
  assert.equal(result.findings.filter((f) => f.ruleId === 'py/duplicate-block').length, 0);
});

test('duplicate-block reports one representative per file', async () => {
  const sameFile = `${BODY}\n${BODY.replace('compute', 'compute_again')}\n`;
  const result = await scanTwoFiles(sameFile, BODY);
  const duplicates = result.findings.filter((f) => f.ruleId === 'py/duplicate-block');
  assert.equal(duplicates.length, 2);
  assert.ok(duplicates.every((finding) => !finding.message.includes(`${finding.file}:`)));
  assert.ok(duplicates.every((finding) => finding.evidence.some((item) => item.startsWith('also at:'))));
});

test('duplicate-block reports nested helpers when their outer functions differ', async () => {
  const nested = (returnValue: string) => [
    'def outer():',
    '    def helper(values):',
    '        total = 0',
    '        for value in values:',
    '            total += value',
    '        total = total * 2',
    '        total = total + 1',
    '        return total',
    `    return helper([${returnValue}])`,
    '',
  ].join('\n');
  const result = await scanTwoFiles(nested('1'), nested('2'));
  const duplicates = result.findings.filter((f) => f.ruleId === 'py/duplicate-block');
  assert.equal(duplicates.length, 2);
  assert.ok(duplicates.every((finding) => finding.snippet.includes('helper')));
});

test('duplicate-block suppresses nested helpers when the enclosing function is duplicated', async () => {
  const nested = [
    'def outer():',
    '    def helper(values):',
    '        total = 0',
    '        for value in values:',
    '            total += value',
    '        total = total * 2',
    '        total = total + 1',
    '        return total',
    '    return helper([1])',
    '',
  ].join('\n');
  const result = await scanTwoFiles(nested, nested);
  const duplicates = result.findings.filter((f) => f.ruleId === 'py/duplicate-block');
  assert.equal(duplicates.length, 2);
  assert.ok(duplicates.every((finding) => finding.snippet.startsWith('def outer')));
});

test('duplicate-block skips files that do not parse', async () => {
  const result = await scanTwoFiles(BODY, `${BODY}\nthis is not python !!!\n`);
  assert.equal(result.findings.filter((f) => f.ruleId === 'py/duplicate-block').length, 0);
  assert.ok(result.stats.parseErrors > 0);
});
