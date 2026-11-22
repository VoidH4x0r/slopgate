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

function hasAsciiRoadRun(text: string): boolean {
  for (const match of text.matchAll(/路{2,}(?:\s+路+)*|路(?:\s+路)+/gu)) {
    const start = match.index ?? 0;
    const before = text.slice(0, start).trimEnd().at(-1) ?? '';
    const after = text.slice(start + match[0].length).trimStart()[0] ?? '';
    if (/[A-Za-z0-9|)\]}([{]/.test(before) || /[A-Za-z0-9|([{]/.test(after)) return true;
  }
  return false;
}

function isCjkDocument(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const chars = [...text].filter((char) => !/\s/.test(char));
  const cjk = chars.filter((char) => /[\u4e00-\u9fff]/u.test(char)).length;
  if (cjk < 5) return false;
  const density = cjk / chars.length;
  const cjkLines = lines.filter((line) => /[\u4e00-\u9fff]/u.test(line)).length;
  if (density < 0.1 || cjkLines / lines.length < 0.3) return false;
  const runs = text.match(/[\u4e00-\u9fff]{4,}/gu) ?? [];
  if (runs.length === 0) return false;
  // Every 4+ CJK run must be free of mojibake markers and must not consist
  // solely of `路` (which would be the `·` mojibake repeated).
  return !runs.some(
    (run) =>
      [...run].some((char) => CJK_MOJIBAKE.test(char)) ||
      [...run].every((char) => char === '路'),
  );
}

/** Returns a reason when a markdown document contains known corruption. */
function markdownProblem(text: string): string | undefined {
  if (text.includes('\uFFFD')) return 'U+FFFD replacement character';
  if (LATIN_MOJIBAKE.test(text)) return 'Latin-1/CP1252 mojibake';
  // Do not fail a document that is actually written in Chinese; its `路` and
  // rare CJK characters are legitimate content.
  if (isCjkDocument(text)) return undefined;
  if (CJK_MOJIBAKE.test(text)) return 'GBK/CP936 mojibake';
  if (hasAsciiRoadRun(text)) return 'repeated 路 (mojibake for ·)';
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
  assert.equal(markdownProblem('中文文档 鈥鈥鈥鈥'), 'GBK/CP936 mojibake');
  assert.equal(markdownProblem('中文文档 路路 说明'), undefined);
  assert.equal(markdownProblem('English 路路路路'), 'repeated 路 (mojibake for ·)');
  assert.equal(markdownProblem('English 路 路 路 路'), 'repeated 路 (mojibake for ·)');
  assert.equal(markdownProblem('English 路路路路路'), 'repeated 路 (mojibake for ·)');
  assert.equal(markdownProblem('中文 路路'), undefined);
  const mixed = [
    'English line one',
    'English line two',
    'English line three',
    'English line four',
    'English line five',
    'English line six',
    'English line seven',
    'English line eight',
    '道路工程 example',
    'A 鈥 marker',
  ].join('\n');
  assert.equal(markdownProblem(mixed), 'GBK/CP936 mojibake');
  const chineseCode = [
    '# 中文文档',
    '',
    '这是中文说明。',
    '',
    '```ts',
    'const x = 1;',
    '```',
  ].join('\n');
  assert.equal(markdownProblem(chineseCode), undefined);
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
