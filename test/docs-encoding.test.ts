import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { ROOT } from './helpers.ts';

const SKIP = new Set(['node_modules', '.git', 'dist', '.tmp']);

// Known GBK/CP936 double-decodes and Latin-1/CP1252 mojibake. Legitimate CJK
// text is allowed so the project can add translated docs later.
const MOJIBAKE = /[\u9225\u922b\u9239\u9241\u9242\u923f\u95f3]|â€|Ã|Â|ð/;
// `路` is a legitimate Chinese character, but a whitespace-delimited `路`
// is the CP936 double-decode of `·`.
const MOJIBAKE_AROUND_ASCII = /(?:^|\s)路(?:\s|$)/u;

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

test('docs: markdown files contain no mojibake or replacement characters', async () => {
  const files = await markdownFiles(ROOT);
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const relative = path.relative(ROOT, file);
    assert.doesNotMatch(text, /\uFFFD/, `${relative} contains U+FFFD`);
    assert.doesNotMatch(text, MOJIBAKE, `${relative} contains known mojibake markers`);
    assert.doesNotMatch(
      text,
      MOJIBAKE_AROUND_ASCII,
      `${relative} contains whitespace-delimited 路 (mojibake for ·)`,
    );
  }

  // Guard the guard: legitimate CJK must pass, common mojibake must not.
  assert.equal(MOJIBAKE.test('中文文档 — 正常'), false);
  assert.equal(MOJIBAKE.test('鈥淎uditing'), true);
  assert.equal(MOJIBAKE.test('â€”'), true);
  assert.equal(MOJIBAKE.test('Ã©'), true);
  assert.equal(MOJIBAKE_AROUND_ASCII.test('slopgate 0.2.3 路 4 files'), true);
  assert.equal(MOJIBAKE_AROUND_ASCII.test('道路工程'), false);
});
