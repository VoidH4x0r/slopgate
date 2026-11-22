#!/usr/bin/env node
/**
 * Fails when a markdown file links to a relative path that does not exist.
 * External URLs are not checked (the build must work offline).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.github']);
const MARKDOWN = /\.md$/i;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
      continue;
    }
    if (MARKDOWN.test(entry.name)) out.push(path.join(dir, entry.name));
  }
  return out;
}

const files = walk(ROOT);
const missing = [];
const checked = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const pattern = /!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const target = match[1];
    if (!target) continue;
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const clean = target.split('#')[0];
    if (!clean) continue;
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(clean));
    checked.push({ file, target });
    if (!existsSync(resolved)) {
      missing.push(`${path.relative(ROOT, file)} -> ${target}`);
    }
  }
}

if (missing.length > 0) {
  console.error(`check-links: ${missing.length} broken relative link(s):`);
  for (const entry of missing) console.error(`  ${entry}`);
  process.exit(1);
}
console.log(`check-links: ${checked.length} relative links across ${files.length} markdown files are valid`);
