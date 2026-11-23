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

async function scanFiles(
  files: Array<{ name: string; source: string }>,
  options: { onlyRules?: string[]; rules?: Record<string, string>; confidence?: 'high' | 'medium' | 'low' } = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-duplicates-'));
  try {
    for (const file of files) {
      const target = path.join(dir, file.name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.source, 'utf8');
    }
    return await scanProject({
      root: dir,
      config: {
        ...DEFAULT_CONFIG,
        include: ['**/*.py', '**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx', '**/*.go', '**/*.rs'],
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

async function scanTwoFiles(
  left: string,
  right: string,
  options: { names?: [string, string]; onlyRules?: string[]; rules?: Record<string, string>; confidence?: 'high' | 'medium' | 'low' } = {},
) {
  const [leftName, rightName] = options.names ?? ['pkg/a.py', 'pkg/b.py'];
  return await scanFiles(
    [
      { name: leftName, source: left },
      { name: rightName, source: right },
    ],
    options,
  );
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

test('duplicate-block covers JavaScript, JSX and TSX files', async () => {
  const jsBody = [
    'const compute = (values) => {',
    '  let total = 0;',
    '  for (const value of values) {',
    '    total += value;',
    '  }',
    '  total = total * 2;',
    '  total = total + 1;',
    '  if (total < 0) throw new Error("negative");',
    '  return total;',
    '};',
    '',
  ].join('\n');
  for (const names of [
    ['pkg/a.js', 'pkg/b.js'],
    ['pkg/a.jsx', 'pkg/b.jsx'],
    ['pkg/a.tsx', 'pkg/b.tsx'],
  ] as Array<[string, string]>) {
    const result = await scanTwoFiles(jsBody, jsBody, {
      names,
      onlyRules: ['ts/duplicate-block'],
    });
    assert.equal(
      result.findings.filter((finding) => finding.ruleId === 'ts/duplicate-block').length,
      2,
      names.join(' / '),
    );
  }
});

test('duplicate-block detects assigned arrow functions and function expressions', async () => {
  const arrow = [
    'const compute = (values) => {',
    '  let total = 0;',
    '  for (const value of values) total += value;',
    '  total *= 2;',
    '  total += 1;',
    '  if (total < 0) throw new Error("negative");',
    '  return total;',
    '};',
    '',
  ].join('\n');
  const expression = [
    'const compute = function (values) {',
    '  let total = 0;',
    '  for (const value of values) total += value;',
    '  total *= 2;',
    '  total += 1;',
    '  if (total < 0) throw new Error("negative");',
    '  return total;',
    '};',
    '',
  ].join('\n');
  for (const body of [arrow, expression]) {
    const result = await scanTwoFiles(body, body, {
      names: ['pkg/a.ts', 'pkg/b.ts'],
      onlyRules: ['ts/duplicate-block'],
    });
    assert.equal(
      result.findings.filter((finding) => finding.ruleId === 'ts/duplicate-block').length,
      2,
    );
  }
});

test('duplicate-block detects generator function declarations', async () => {
  const generator = [
    'function* sequence(values: number[]) {',
    '  let total = 0;',
    '  for (const value of values) {',
    '    total += value;',
    '    yield total;',
    '  }',
    '  total *= 2;',
    '  total += 1;',
    '  return total;',
    '}',
    '',
  ].join('\n');
  const result = await scanTwoFiles(generator, generator, {
    names: ['pkg/a.ts', 'pkg/b.ts'],
    onlyRules: ['ts/duplicate-block'],
  });
  assert.equal(
    result.findings.filter((finding) => finding.ruleId === 'ts/duplicate-block').length,
    2,
  );
});

test('duplicate-block preserves whitespace inside strings', async () => {
  const left = BODY.replace('raise ValueError("negative")', 'raise ValueError("hello   world")');
  const right = BODY.replace('raise ValueError("negative")', 'raise ValueError("hello world")');
  const result = await scanTwoFiles(left, right, { onlyRules: ['py/duplicate-block'] });
  assert.equal(
    result.findings.filter((finding) => finding.ruleId === 'py/duplicate-block').length,
    0,
  );
});

test('semantic-duplicate keeps a renamed member when others are exact clones', async () => {
  const renamed = BODY.replaceAll('total', 'acc').replace('compute', 'compute_renamed');
  const result = await scanFiles(
    [
      { name: 'pkg/a.py', source: BODY },
      { name: 'pkg/b.py', source: BODY },
      { name: 'pkg/c.py', source: renamed },
    ],
    {
      onlyRules: ['py/semantic-duplicate'],
      confidence: 'medium',
    },
  );
  const semantic = result.findings.filter((finding) => finding.ruleId === 'py/semantic-duplicate');
  assert.equal(semantic.length, 1);
  assert.equal(semantic[0]?.file, 'pkg/c.py');
});

test('concurrent scans do not share project-rule state', async () => {
  const make = async (prefix: string) => {
    const dir = await mkdtemp(path.join(tmpdir(), `slopgate-concurrent-${prefix}-`));
    await writeFile(path.join(dir, `${prefix}1.py`), BODY, 'utf8');
    await writeFile(path.join(dir, `${prefix}2.py`), BODY, 'utf8');
    return dir;
  };
  const left = await make('left');
  const right = await make('right');
  const config = {
    ...DEFAULT_CONFIG,
    include: ['**/*.py'],
    exclude: [],
    confidence: 'medium' as const,
  };
  try {
    const [a, b] = await Promise.all([
      scanProject({ root: left, config, onlyRules: new Set(['py/duplicate-block']) }),
      scanProject({ root: right, config, onlyRules: new Set(['py/duplicate-block']) }),
    ]);
    assert.deepEqual(a.findings.map((finding) => finding.file).sort(), ['left1.py', 'left2.py']);
    assert.deepEqual(b.findings.map((finding) => finding.file).sort(), ['right1.py', 'right2.py']);
  } finally {
    await rm(left, { recursive: true, force: true });
    await rm(right, { recursive: true, force: true });
  }
});

test('Rust duplicate-block skips @generated markers consistently', async () => {
  const source = [
    '// @generated by fixturegen',
    '',
    'fn generated() -> i32 {',
    '    let mut x = 1;',
    '    x += 2;',
    '    x += 3;',
    '    x += 4;',
    '    x',
    '}',
    '',
  ].join('\n');
  const result = await scanTwoFiles(source, source, {
    names: ['pkg/a.rs', 'pkg/b.rs'],
    onlyRules: ['rs/duplicate-block'],
    confidence: 'medium',
  });
  assert.equal(
    result.findings.filter((finding) => finding.ruleId === 'rs/duplicate-block').length,
    0,
  );
});

test('Go duplicate-block skips platform and generated files', async () => {
  const body = [
    'package main',
    '',
    'func alpha() {',
    '  x := 1',
    '  x += 2',
    '  x += 3',
    '  x += 4',
    '  println(x)',
    '}',
    '',
  ].join('\n');
  for (const names of [
    ['pkg/a_linux.go', 'pkg/b_linux.go'],
    ['pkg/a_windows.go', 'pkg/b_windows.go'],
  ] as Array<[string, string]>) {
    const result = await scanTwoFiles(body, body, {
      names,
      onlyRules: ['go/duplicate-block'],
      confidence: 'medium',
    });
    assert.equal(
      result.findings.filter((finding) => finding.ruleId === 'go/duplicate-block').length,
      0,
      names.join(' / '),
    );
  }
  const generated = [
    ...Array.from({ length: 21 }, (_, index) => `// license ${index + 1}`),
    '// Code generated by fixturegen. DO NOT EDIT.',
    '',
    body,
  ].join('\n');
  const result = await scanTwoFiles(generated, generated, {
    names: ['pkg/a.go', 'pkg/b.go'],
    onlyRules: ['go/duplicate-block'],
    confidence: 'medium',
  });
  assert.equal(
    result.findings.filter((finding) => finding.ruleId === 'go/duplicate-block').length,
    0,
  );
});

test('Go/Rust exact duplicate keeps whitespace inside string literals', async () => {
  const goLeft = [
    'package main',
    '',
    'func alpha() {',
    '  x := "hello   world"',
    '  println(x)',
    '  x = "a"',
    '  x = "b"',
    '  x = "c"',
    '  println(x)',
    '}',
    '',
  ].join('\n');
  const goRight = goLeft.replace('hello   world', 'hello world');
  const rustLeft = [
    'fn alpha() {',
    '    let x = "hello   world";',
    '    println!("{}", x);',
    '    let x = "a";',
    '    let x = "b";',
    '    let x = "c";',
    '    println!("{}", x);',
    '}',
    '',
  ].join('\n');
  const rustRight = rustLeft.replace('hello   world', 'hello world');
  for (const [left, right, name, rule] of [
    [goLeft, goRight, ['pkg/a.go', 'pkg/b.go'], 'go/duplicate-block'],
    [rustLeft, rustRight, ['pkg/a.rs', 'pkg/b.rs'], 'rs/duplicate-block'],
  ] as Array<[string, string, [string, string], string]>) {
    const result = await scanTwoFiles(left, right, {
      names: name,
      onlyRules: [rule],
      confidence: 'medium',
    });
    assert.equal(
      result.findings.filter((finding) => finding.ruleId === rule).length,
      0,
      rule,
    );
  }
});

test('semantic-duplicate keeps a renamed clone after an exact clone in the same file', async () => {
  const renamed = BODY.replaceAll('total', 'acc').replace('compute', 'compute_renamed');
  const result = await scanFiles(
    [
      { name: 'pkg/a.py', source: BODY },
      { name: 'pkg/b.py', source: `${BODY}\n${renamed}` },
      { name: 'pkg/c.py', source: BODY },
    ],
    {
      onlyRules: ['py/semantic-duplicate'],
      confidence: 'medium',
    },
  );
  const semantic = result.findings.filter((finding) => finding.ruleId === 'py/semantic-duplicate');
  assert.equal(semantic.length, 1);
  assert.equal(semantic[0]?.file, 'pkg/b.py');
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
