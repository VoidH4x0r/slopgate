import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { ROOT } from './helpers.ts';

const POLICY = JSON.parse(
  await readFile(path.join(ROOT, 'scripts', 'encoding-policy.json'), 'utf8'),
) as {
  allowedNonAscii: number[];
  localizedPrefixes: string[];
  localizedSuffixes: string[];
};
const ALLOWED = new Set(POLICY.allowedNonAscii);

function isLocalizedDoc(relative: string): boolean {
  const normalized = relative.split(path.sep).join('/');
  if (POLICY.localizedPrefixes.some((prefix) => normalized.startsWith(prefix))) return true;
  return POLICY.localizedSuffixes.some((suffix) => normalized.endsWith(suffix));
}

/** English docs are a whitelist; localized docs are a path contract. */
function markdownProblem(text: string, relative = 'README.md'): string | undefined {
  if (text.charCodeAt(0) === 0xfeff) return 'UTF-8 BOM';
  if (text.includes('\uFEFF')) return 'U+FEFF zero-width no-break space';
  if (text.includes('\uFFFD')) return 'U+FFFD replacement character';
  if (isLocalizedDoc(relative)) return undefined;

  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint > 0x7f && !ALLOWED.has(codePoint)) {
      return `unexpected non-ASCII U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    }
  }
  return undefined;
}

async function markdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'dist', 'coverage'].includes(entry.name)) continue;
      if (entry.name.startsWith('.tmp')) continue;
      out.push(...(await markdownFiles(path.join(dir, entry.name))));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) out.push(path.join(dir, entry.name));
  }
  return out;
}

test('docs: English markdown uses the whitelist and localized markdown is a path contract', async () => {
  const files = await markdownFiles(ROOT);
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const relative = path.relative(ROOT, file);
    assert.equal(
      markdownProblem(text, relative),
      undefined,
      `${relative} violates the encoding policy`,
    );
  }

  // Deliberate typography is allowed.
  assert.equal(markdownProblem('English — – · │ → ← ↳ ≈ … “ ” ‘ ’ § ✅ ❌ ⚠️'), undefined);
  // A bare U+8DEF is not allowed in an English document, but is fine in docs/zh.
  assert.equal(markdownProblem('slopgate 0.2.3 路 4 files'), 'unexpected non-ASCII U+8DEF');
  assert.equal(markdownProblem('中文文档', 'docs/zh/README.md'), undefined);
  assert.equal(markdownProblem('中文文档', 'README.zh-CN.md'), undefined);
  assert.equal(markdownProblem('中文文档', 'README.md'), 'unexpected non-ASCII U+4E2D');
  // BOM/replacement characters fail everywhere.
  assert.equal(markdownProblem('\uFEFF# title'), 'UTF-8 BOM');
  assert.equal(markdownProblem('English \uFFFD'), 'U+FFFD replacement character');
});
