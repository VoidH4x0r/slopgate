#!/usr/bin/env node
/**
 * Download and unpack the real AI pull request corpus.
 *
 *   node scripts/fetch-ai-pr-corpus.mjs
 *   node scripts/fetch-ai-pr-corpus.mjs --out benchmark/ai-pr/cache
 *
 * The corpus lives in a GitHub release asset because it contains code from
 * third-party repositories. `benchmark/ai-pr/manifest.json` records the asset
 * URL and its SHA-256; the archive is verified before it is unpacked.
 */
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTarGz } from './tar-extract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MANIFEST = path.join(ROOT, 'benchmark', 'ai-pr', 'manifest.json');

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

// The corpus must live outside the repository: an in-repo cache lets the
// project resolver walk up into slopgate itself and resolve the wrong root.
const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
const defaultCache = path.join(cacheHome, 'slopgate', 'ai-pr');
const outDir = path.resolve(ROOT, arg('out', defaultCache));
const archive = path.join(outDir, 'ai-pr-corpus-v1.tar.gz');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const expected = manifest.asset.sha256;

// The manifest is data, so the URL it carries is validated before use: only
// HTTPS downloads from this project's GitHub release page are allowed.
function releaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw new Error(`refusing to download from ${url.href}`);
  }
  if (!url.pathname.startsWith('/VoidH4x0r/slopgate/releases/download/')) {
    throw new Error(`refusing to download from ${url.href}`);
  }
  return url;
}

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const cached = await readFile(archive).catch(() => undefined);
if (cached && digest(cached) === expected) {
  console.log('archive already verified');
} else {
  await mkdir(outDir, { recursive: true });
  let buffer;
  for (let attempt = 1; attempt <= 3 && !buffer; attempt += 1) {
    try {
      console.log(`downloading ${manifest.asset.name} (attempt ${attempt})`);
      const response = await fetch(releaseUrl(manifest.asset.url), {
        redirect: 'follow',
        signal: AbortSignal.timeout(180000),
      });
      if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText}`);
      buffer = Buffer.from(await response.arrayBuffer());
    } catch (err) {
      if (attempt === 3) throw err;
      console.warn(`download attempt ${attempt} failed: ${err.message}`);
    }
  }
  const actual = digest(buffer);
  if (actual !== expected) throw new Error(`asset digest mismatch: expected ${expected}, got ${actual}`);
  await writeFile(archive, buffer);
  console.log(`downloaded ${manifest.asset.name} (${(buffer.length / 1048576).toFixed(1)} MB)`);
}

const skeletons = path.join(outDir, 'skeletons');
const marker = path.join(skeletons, '.complete');
const markerText = await readFile(marker, 'utf8').catch(() => undefined);
if (markerText === undefined) {
  rmSync(skeletons, { recursive: true, force: true });
  await mkdir(skeletons, { recursive: true });
  const extracted = extractTarGz(archive, skeletons);
  console.log(`unpacked ${extracted} files`);
  await writeFile(marker, `${manifest.asset.sha256}\n`, 'utf8');
  console.log('unpacked corpus');
} else {
  console.log('corpus already unpacked');
}

let missing = 0;
for (const pr of manifest.prs) {
  const dir = path.join(skeletons, `${pr.repo.replace('/', '__')}__${pr.sha.slice(0, 10)}`);
  for (const file of pr.files) {
    const target = path.join(dir, ...file.path.split('/'));
    const content = await readFile(target).catch(() => undefined);
    if (!content || content.length === 0) {
      missing += 1;
      console.error(`missing: ${pr.repo}#${pr.number} ${file.path}`);
    }
  }
}
if (missing > 0) throw new Error(`${missing} corpus files are missing after unpacking`);
console.log(`corpus ready: ${manifest.totals.prs} pull requests, ${manifest.totals.files} changed files`);
