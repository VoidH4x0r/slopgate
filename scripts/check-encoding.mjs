#!/usr/bin/env node
/**
 * Repository encoding contract.
 *
 * Every text file must be valid UTF-8 without a BOM or U+FFFD. English docs
 * may only contain the typographic characters listed in encoding-policy.json.
 * Translations live under docs/zh/ or use a .zh*.md suffix and may contain
 * arbitrary Unicode, but still must pass the UTF-8/BOM checks.
 *
 * This deliberately does not guess whether a character is "really Chinese".
 * Language is a path contract, not a content heuristic.
 */
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLICY = JSON.parse(
  await readFile(path.join(ROOT, 'scripts', 'encoding-policy.json'), 'utf8'),
);
const ALLOWED = new Set(POLICY.allowedNonAscii);
const LOCALIZED_PREFIXES = POLICY.localizedPrefixes;
const LOCALIZED_SUFFIXES = POLICY.localizedSuffixes;
const BOM_ALLOWLIST = new Set(POLICY.bomAllowlist ?? []);

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.txt',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.py',
  '.toml',
  '.sh',
  '.ps1',
  '.css',
  '.html',
]);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.npm-cache']);

function isLocalizedDoc(relative) {
  if (LOCALIZED_PREFIXES.some((prefix) => relative.startsWith(prefix))) return true;
  return LOCALIZED_SUFFIXES.some((suffix) => relative.endsWith(suffix));
}

function isEnglishDoc(relative) {
  return relative.endsWith('.md') && !isLocalizedDoc(relative);
}

function checkText(relative, text) {
  const errors = [];
  if (text.charCodeAt(0) === 0xfeff) errors.push('UTF-8 BOM');
  if (text.includes('\uFEFF')) errors.push('U+FEFF zero-width no-break space');
  if (text.includes('\uFFFD')) errors.push('U+FFFD replacement character');

  if (isEnglishDoc(relative)) {
    for (const char of text) {
      const codePoint = char.codePointAt(0);
      if (codePoint > 0x7f && !ALLOWED.has(codePoint)) {
        errors.push(
          `unexpected non-ASCII U+${codePoint.toString(16).toUpperCase().padStart(4, '0')} ` +
            `(${JSON.stringify(char)}); use docs/zh/ for Chinese text or extend encoding-policy.json`,
        );
      }
    }
  }
  return errors;
}

async function walk(dir, out) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.tmp')) continue;
      await walk(path.join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    out.push(path.join(dir, entry.name));
  }
}

const files = [];
await walk(ROOT, files);
const failures = [];
for (const file of files) {
  const relative = path.relative(ROOT, file).split(path.sep).join('/');
  const buffer = await readFile(file);
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf &&
    !BOM_ALLOWLIST.has(relative)
  ) {
    failures.push(`${relative}: UTF-8 BOM`);
    continue;
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    failures.push(`${relative}: invalid UTF-8`);
    continue;
  }
  for (const error of checkText(relative, text)) {
    failures.push(`${relative}: ${error}`);
  }
}

if (failures.length > 0) {
  console.error(`encoding: ${failures.length} problem(s) in ${files.length} text files`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`encoding: ${files.length} text files OK (UTF-8, BOM policy, English docs whitelist)`);
}
