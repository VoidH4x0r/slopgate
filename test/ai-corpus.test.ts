import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { scanProject } from '../src/engine.ts';
import { ROOT } from './helpers.ts';

test('AI corpus fixture meets its seeded expectations', async () => {
  const seeded = JSON.parse(
    await readFile(path.join(ROOT, 'benchmark', 'seeded.json'), 'utf8'),
  ) as {
    corpora: Array<{ fixture: string; expected: Array<{ file: string; ruleId: string }> }>;
  };
  const ai = seeded.corpora.find((corpus) => corpus.fixture === 'fixtures/ai-generated');
  assert.ok(ai, 'seeded corpus is missing');
  const result = await scanProject({
    root: path.join(ROOT, 'fixtures', 'ai-generated'),
    config: { ...DEFAULT_CONFIG },
  });
  const found = new Set(result.findings.map((finding) => `${finding.file}|${finding.ruleId}`));
  const missed = ai.expected.filter((entry) => !found.has(`${entry.file}|${entry.ruleId}`));
  assert.deepEqual(missed, []);
});

test('AI corpus clean controls have no findings', async () => {
  const result = await scanProject({
    root: path.join(ROOT, 'fixtures', 'ai-generated', 'clean'),
    config: { ...DEFAULT_CONFIG },
  });
  assert.deepEqual(result.findings, []);
});
