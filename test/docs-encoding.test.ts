import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { ROOT } from './helpers.ts';

const SKIP = new Set(['node_modules', '.git', 'dist', '.tmp']);

// Known GBK/CP936 double-decodes. Legitimate CJK text is allowed in files
// that are actually written in Chinese; see cjkRatio below.
const CJK_MOJIBAKE = /[\u9225\u922b\u9239\u9241\u9242\u923f\u95f3\u72c5\u7b0d\u6dce]/u;
const LATIN_MOJIBAKE = /â€|Ã[\u0080-\u00bf]|Â[\u0080-\u00bf]|ð[\u0080-\u017f]/u;
// `路` is a legitimate Chinese character. Mojibake `路` for `·` appears in
// ASCII/number/table context; Chinese prose such as `前方 路 口` must pass.
const MOJIBAKE_AROUND_ASCII =
  /(?:[A-Za-z0-9|)\]}])\s*路(?=\s|$)|(?:^|\s)路(?=\s*[A-Za-z0-9|([{])/u;

function isCjkDocument(text: string): boolean {
  const chars = [...text].filter((char) => !/\s/.test(char));
  const cjk = chars.filter((char) => /[\u4e00-\u9fff]/u.test(char)).length;
  if (cjk < 5) return false;
  const run = text.match(/[\u4e00-\u9fff]{4,}/u)?.[0];
  if (!run) return false;
  // A run made of mojibake markers is not evidence of a Chinese document.
  return ![...run].some((char) => CJK_MOJIBAKE.test(char));
}

/** Returns a reason when a markdown document contains known corruption. */
function markdownProblem(text: string): string | undefined {
  if (text.includes('\uFFFD')) return 'U+FFFD replacement character';
  if (LATIN_MOJIBAKE.test(text)) return 'Latin-1/CP1252 mojibake';
  // Do not fail a document that is actually written in Chinese; its `路` and
  // rare CJK characters are legitimate content.
  if (isCjkDocument(text)) return undefined;
  if (CJK_MOJIBAKE.test(text)) return 'GBK/CP936 mojibake';
  if (MOJIBAKE_AROUND_ASCII.test(text)) return 'whitespace-delimited 路 (mojibake for ·)';
  return undefined;
}

async function markdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name) || entry.name.startsWith('.tmp')) continue;
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
    const problem = markdownProblem(text);
    assert.equal(problem, undefined, `${relative} contains ${problem ?? 'no problem'}`);
  }

  // Guard the guard: legitimate CJK must pass, common mojibake must not.
  assert.equal(markdownProblem('中文文档 — 正常'), undefined);
  assert.equal(markdownProblem('前方 路 口'), undefined);
  assert.equal(markdownProblem('中文文档 路 说明'), undefined);
  assert.equal(markdownProblem('中文文档 包含 鈥 字符'), undefined);
  assert.equal(markdownProblem('English 鈥 鈥 鈥 鈥 鈥'), 'GBK/CP936 mojibake');
  assert.equal(markdownProblem('English 鈥鈥鈥鈥'), 'GBK/CP936 mojibake');
  assert.equal(markdownProblem('slopgate 0.2.3 路 4 files'), 'whitespace-delimited 路 (mojibake for ·)');
  assert.equal(markdownProblem('English text 鈥淎uditing'), 'GBK/CP936 mojibake');
  assert.equal(markdownProblem('English â€”'), 'Latin-1/CP1252 mojibake');
  assert.equal(markdownProblem('English Ã©'), 'Latin-1/CP1252 mojibake');
  assert.equal(markdownProblem('English Ã'), undefined);
  assert.equal(markdownProblem('English Â'), undefined);
  assert.equal(markdownProblem('English ð'), undefined);
  assert.equal(markdownProblem('English 狅'), 'GBK/CP936 mojibake');
});
