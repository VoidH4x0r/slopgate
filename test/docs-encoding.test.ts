import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { ROOT } from './helpers.ts';

const SKIP = new Set(['node_modules', '.git', 'dist', '.tmp']);

async function markdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      out.push(...(await markdownFiles(path.join(dir, entry.name))));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) out.push(path.join(dir, entry.name));
  }
  return out;
}

test('docs: markdown files contain no CJK mojibake or replacement characters', async () => {
  const files = await markdownFiles(ROOT);
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const relative = path.relative(ROOT, file);
    assert.doesNotMatch(text, /\uFFFD/, `${relative} contains U+FFFD`);
    assert.doesNotMatch(
      text,
      /[\u4e00-\u9fff]/,
      `${relative} contains CJK characters, usually a GBK/CP936 double-decode`,
    );
    assert.doesNotMatch(
      text,
      /[\u9225\u922b\u9239\u8def\u9241\u9242\u923f\u95f3]/,
      `${relative} contains known mojibake markers`,
    );
  }
});
