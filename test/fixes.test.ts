import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { scanProject } from '../src/engine.ts';
import { applyFixes } from '../src/fix.ts';

async function fixture(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-fixes-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

async function scan(dir: string) {
  return scanProject({
    root: dir,
    config: { ...DEFAULT_CONFIG, include: ['**/*.py', '**/*.ts'], exclude: [] },
  });
}

test('fix removes Python unreachable lines and is idempotent', async () => {
  const dir = await fixture({
    'app.py': 'def f():\n    return 1\n    print("dead")\n    print("also dead")\n',
  });
  try {
    const first = await scan(dir);
    assert.equal(first.fixes.length, 1);
    const applied = await applyFixes(first.fixes, { write: true });
    assert.equal(applied.fixedFindings, 1);
    const text = await readFile(path.join(dir, 'app.py'), 'utf8');
    assert.equal(text, 'def f():\n    return 1\n');
    const second = await scan(dir);
    assert.equal(second.fixes.length, 0);
    assert.equal(second.findings.filter((f) => f.ruleId === 'py/unreachable').length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fix preserves BOM and CRLF', async () => {
  const dir = await fixture({
    'app.py': '\uFEFFdef f():\r\n    return 1\r\n    print("dead")\r\n',
  });
  try {
    const result = await scan(dir);
    await applyFixes(result.fixes, { write: true });
    const raw = await readFile(path.join(dir, 'app.py'));
    assert.equal(raw[0], 0xef);
    const text = raw.toString('utf8').replace(/^\uFEFF/, '');
    assert.equal(text, 'def f():\r\n    return 1\r\n');
    assert.ok(text.includes('\r\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fix only removes runtime TS statements and keeps hoisted declarations', async () => {
  const dir = await fixture({
    'app.ts': [
      'function f() {',
      '  return 1;',
      '  function later() { return 2; }',
      '  console.log("dead");',
      '}',
      '',
    ].join('\n'),
  });
  try {
    const result = await scan(dir);
    await applyFixes(result.fixes, { write: true });
    const text = await readFile(path.join(dir, 'app.ts'), 'utf8');
    assert.match(text, /function later/);
    assert.doesNotMatch(text, /console\.log/);
    assert.match(text, /return 1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dry-run validates edits without writing', async () => {
  const dir = await fixture({
    'app.py': 'def f():\n    return 1\n    print("dead")\n',
  });
  try {
    const original = await readFile(path.join(dir, 'app.py'), 'utf8');
    const result = await scan(dir);
    const dry = await applyFixes(result.fixes, { write: false });
    assert.equal(dry.fixedFindings, 1);
    assert.equal(await readFile(path.join(dir, 'app.py'), 'utf8'), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fix refuses stale offsets when the file changed after scanning', async () => {
  const dir = await fixture({
    'app.py': 'def f():\n    return 1\n    print("dead")\n',
  });
  try {
    const result = await scan(dir);
    const changed = 'def f():\n    return 2\n    print("dead")\n';
    await writeFile(path.join(dir, 'app.py'), changed);
    const applied = await applyFixes(result.fixes, { write: true });
    assert.equal(applied.fixedFindings, 0);
    assert.equal(applied.skippedFindings, 1);
    assert.match(applied.warnings.join('\n'), /changed after it was scanned/);
    assert.equal(await readFile(path.join(dir, 'app.py'), 'utf8'), changed);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fix reports a missing file without writing anything', async () => {
  const dir = await fixture({
    'app.py': 'def f():\n    return 1\n    print("dead")\n',
  });
  try {
    const result = await scan(dir);
    await rm(path.join(dir, 'app.py'));
    const applied = await applyFixes(result.fixes, { write: true });
    assert.equal(applied.fixedFindings, 0);
    assert.equal(applied.skippedFindings, 1);
    assert.match(applied.warnings.join('\n'), /could not read/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fix skips overlapping edits instead of corrupting the file', async () => {
  const dir = await fixture({ 'app.py': '1234567890\n' });
  try {
    const fake = {
      finding: {
        ruleId: 'py/unreachable',
        message: 'x',
        severity: 'error' as const,
        confidence: 'high' as const,
        file: 'app.py',
        start: { line: 1, column: 1 },
        end: { line: 1, column: 2 },
        snippet: '1',
        evidence: [],
      },
      fileAbs: path.join(dir, 'app.py'),
      sourceHash: createHash('sha1').update('1234567890\n').digest('hex'),
      edits: [
        { start: 0, end: 5, replacement: '' },
        { start: 4, end: 6, replacement: '' },
      ],
    };
    const result = await applyFixes([fake], { write: true });
    assert.equal(result.fixedFindings, 0);
    assert.equal(result.skippedFindings, 1);
    assert.equal(await readFile(path.join(dir, 'app.py'), 'utf8'), '1234567890\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
