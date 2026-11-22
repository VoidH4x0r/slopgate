import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSafeRef,
  isInDiff,
  isInDiffWithPrefix,
  normalizeGitPath,
  parseUnifiedDiff,
} from '../src/diff.ts';
import type { Finding } from '../src/types.ts';

const SAMPLE = [
  'diff --git a/app.py b/app.py',
  'index 1111111..2222222 100644',
  '--- a/app.py',
  '+++ b/app.py',
  '@@ -10,0 +11,3 @@ def f():',
  '+import x',
  '+import y',
  '+import z',
  'diff --git a/new.py b/new.py',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/new.py',
  '@@ -0,0 +1,2 @@',
  '+a = 1',
  '+b = 2',
].join('\n');

function finding(file: string, line: number): Finding {
  return {
    ruleId: 'py/phantom-import',
    message: 'x',
    severity: 'error',
    confidence: 'high',
    file,
    start: { line, column: 1 },
    end: { line, column: 1 },
    snippet: '',
    evidence: [],
  };
}

test('parseUnifiedDiff ignores content lines that look like file headers', () => {
  const diff = [
    'diff --git a/src/preinc.ts b/src/preinc.ts',
    '--- a/src/preinc.ts',
    '+++ b/src/preinc.ts',
    '@@ -10,0 +11,1 @@',
    '++ x;',
    '@@ -40,0 +42,2 @@',
    '+const a = 1;',
    '+const b = 2;',
  ].join('\n');
  const set = parseUnifiedDiff(diff);
  assert.deepEqual(
    [...(set.lines.get('src/preinc.ts') ?? [])].sort((a, b) => a - b),
    [11, 42, 43],
  );
  assert.equal(set.lines.has('x;'), false);
});

test('parseUnifiedDiff tracks context and deletion lines in a hunk', () => {
  const diff = [
    'diff --git a/app.ts b/app.ts',
    '--- a/app.ts',
    '+++ b/app.ts',
    '@@ -1,2 +1,2 @@',
    ' context',
    '+added',
    '-removed',
    '@@ -4,0 +5,1 @@',
    '+after',
  ].join('\n');
  const set = parseUnifiedDiff(diff);
  assert.deepEqual([...(set.lines.get('app.ts') ?? [])], [2, 5]);
});

test('parseUnifiedDiff does not create an empty entry for a deletion-only hunk', () => {
  const diff = [
    'diff --git a/x.py b/x.py',
    '--- a/x.py',
    '+++ b/x.py',
    '@@ -1,2 +1,0 @@',
    '-one',
    '-two',
  ].join('\n');
  const set = parseUnifiedDiff(diff);
  assert.equal(set.lines.size, 0);
});

test('parseUnifiedDiff records added lines per file', () => {
  const set = parseUnifiedDiff(SAMPLE);
  assert.deepEqual([...(set.lines.get('app.py') ?? [])].sort((a, b) => a - b), [11, 12, 13]);
});

test('parseUnifiedDiff marks brand new files as fully changed', () => {
  const set = parseUnifiedDiff(SAMPLE);
  assert.equal(set.full.has('new.py'), true);
  assert.equal(set.full.has('app.py'), false);
});

test('isInDiff matches changed lines and whole new files', () => {
  const set = parseUnifiedDiff(SAMPLE);
  assert.equal(isInDiff(finding('app.py', 12), set), true);
  assert.equal(isInDiff(finding('app.py', 99), set), false);
  assert.equal(isInDiff(finding('new.py', 999), set), true);
  assert.equal(isInDiff(finding('other.py', 1), set), false);
});

test('parseUnifiedDiff handles an empty diff', () => {
  const set = parseUnifiedDiff('');
  assert.equal(set.lines.size, 0);
  assert.equal(set.full.size, 0);
});

test('normalizeGitPath strips prefixes, trailing tabs and quotes', () => {
  assert.equal(normalizeGitPath('b/src/app.py'), 'src/app.py');
  assert.equal(normalizeGitPath('src/app.py'), 'src/app.py');
  // Paths containing a space are followed by a tab in git's diff header.
  assert.equal(normalizeGitPath('b/my file.py\t'), 'my file.py');
  assert.equal(normalizeGitPath('"b/with space.py"'), 'with space.py');
  assert.equal(normalizeGitPath('"b/quote\\"d.py"'), 'quote"d.py');
});

test('normalizeGitPath decodes octal UTF-8 escapes from default quotePath', () => {
  // 中文.py, as git escapes it with core.quotePath=true.
  const quoted = '"b/\\344\\270\\255\\346\\226\\207.py"';
  assert.equal(normalizeGitPath(quoted), '中文.py');
});

test('parseUnifiedDiff keeps space and non-ASCII file names', () => {
  const diff = [
    'diff --git a/space file.py b/space file.py',
    '--- a/space file.py\t',
    '+++ b/space file.py\t',
    '@@ -0,0 +1 @@',
    '+import phantom_space',
    'diff --git a/中文文件.py b/中文文件.py',
    '--- a/中文文件.py\t',
    '+++ b/中文文件.py\t',
    '@@ -0,0 +1 @@',
    '+import phantom_cjk',
  ].join('\n');
  const set = parseUnifiedDiff(diff);
  assert.deepEqual([...set.lines.keys()].sort(), ['space file.py', '中文文件.py']);
  assert.equal(set.lines.get('space file.py')?.has(1), true);
});

test('parseUnifiedDiff marks a new file with spaces as fully changed', () => {
  const diff = [
    'diff --git a/new file.py b/new file.py',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/new file.py\t',
    '@@ -0,0 +1 @@',
    '+x = 1',
  ].join('\n');
  const set = parseUnifiedDiff(diff);
  assert.equal(set.full.has('new file.py'), true);
  assert.equal(isInDiff(finding('new file.py', 40), set), true);
});

test('assertSafeRef rejects option-like refs and accepts normal refs', () => {
  assert.equal(assertSafeRef('HEAD'), 'HEAD');
  assert.equal(assertSafeRef('origin/main'), 'origin/main');
  assert.equal(assertSafeRef('feature/my-branch'), 'feature/my-branch');
  assert.throws(() => assertSafeRef('--output=/tmp/pwned'), /invalid git ref/);
  assert.throws(() => assertSafeRef('-p'), /invalid git ref/);
  assert.throws(() => assertSafeRef(''), /empty git ref/);
});

test('isInDiffWithPrefix maps subdirectory findings onto repo-root diff paths', () => {
  const diff = [
    'diff --git a/src/app.py b/src/app.py',
    '--- a/src/app.py',
    '+++ b/src/app.py',
    '@@ -10,0 +11,2 @@',
    '+import x',
    '+import y',
  ].join('\n');
  const set = parseUnifiedDiff(diff);
  const subFinding = finding('app.py', 11);
  assert.equal(isInDiffWithPrefix(subFinding, set, 'src'), true);
  assert.equal(isInDiffWithPrefix(subFinding, set, ''), false);
  assert.equal(isInDiffWithPrefix(subFinding, set, '../outside'), false);
  // Already repo-root relative: the prefix must not double-apply.
  assert.equal(isInDiffWithPrefix(finding('src/app.py', 11), set, 'src'), true);
});
