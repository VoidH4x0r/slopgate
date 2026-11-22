import assert from 'node:assert/strict';
import test from 'node:test';
import { renderGithub } from '../src/reporters/github.ts';
import type { Finding, ScanStats } from '../src/types.ts';

const stats: ScanStats = {
  files: 12,
  byLanguage: { python: 8, typescript: 4, tsx: 0 },
  skipped: 0,
  parseErrors: 0,
  durationMs: 42,
};

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'py/phantom-import',
    message: '`requests_v2` is imported but not declared',
    severity: 'error',
    confidence: 'high',
    file: 'src/app.py',
    start: { line: 4, column: 1 },
    end: { line: 4, column: 18 },
    snippet: 'import requests_v2',
    evidence: [],
    ...overrides,
  };
}

test('renderGithub emits one annotation per finding plus a summary notice', () => {
  const output = renderGithub([finding(), finding({ severity: 'warning', ruleId: 'py/noop-test' })], stats);
  const lines = output.trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0] ?? '', /^::error file=src\/app\.py,line=4,col=1,endLine=4,endColumn=18,title=py\/phantom-import::/);
  assert.match(lines[1] ?? '', /^::warning /);
  assert.match(lines[2] ?? '', /^::notice title=slopgate::2 finding\(s\) \(1 error, 1 warning\) · 12 files scanned in 42ms/);
});

test('renderGithub escapes workflow-command metacharacters', () => {
  const output = renderGithub(
    [
      finding({
        file: 'dir/a,b:c.py',
        message: '50% of lines\nare bad',
        ruleId: 'py/a:b',
      }),
    ],
    stats,
  );
  const line = output.split('\n')[0] ?? '';
  assert.ok(line.includes('file=dir/a%2Cb%3Ac.py'), line);
  assert.ok(line.includes('title=py/a%3Ab'), line);
  assert.ok(line.includes('50%25 of lines%0Aare bad'), line);
});

test('renderGithub maps info findings to notice annotations', () => {
  const output = renderGithub([finding({ severity: 'info' })], stats);
  assert.match(output, /^::notice file=/);
});

test('renderGithub still reports a summary when there is nothing to annotate', () => {
  const output = renderGithub([], stats);
  const lines = output.trimEnd().split('\n');
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? '', /^::notice title=slopgate::0 finding\(s\)/);
});
