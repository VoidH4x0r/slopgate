#!/usr/bin/env node
/**
 * Precision benchmark for real AI-authored pull requests.
 *
 *   node scripts/fetch-ai-pr-corpus.mjs
 *   node scripts/benchmark-ai-pr.mjs
 *
 * Each corpus entry is a repository skeleton at the PR merge commit: the real
 * dependency manifests, the files the PR changed, and empty placeholders for
 * every other source file so import resolution sees the repository layout.
 * Only the changed files are scanned.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findingFingerprint } from '../dist/baseline.js';
import { DEFAULT_CONFIG } from '../dist/config.js';
import { scanProject } from '../dist/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MANIFEST = path.join(ROOT, 'benchmark', 'ai-pr', 'manifest.json');
const LABELS = path.join(ROOT, 'benchmark', 'ai-pr', 'labels.json');

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const labels = JSON.parse(readFileSync(LABELS, 'utf8'));
const cache = path.resolve(ROOT, arg('cache', 'benchmark/ai-pr/cache'));
const skeletons = path.join(cache, 'skeletons');
const outPath = path.resolve(ROOT, arg('out', 'benchmark/ai-pr/results.json'));
const reportPath = path.resolve(ROOT, arg('report', 'benchmark/ai-pr/report.md'));
const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

if (!existsSync(path.join(skeletons, '.complete'))) {
  throw new Error('corpus missing: run `node scripts/fetch-ai-pr-corpus.mjs` first');
}
if (!existsSync(path.join(ROOT, 'dist', 'engine.js'))) {
  throw new Error('dist/ is missing. Run `npm run build` first.');
}

const prs = [];
let verifyFailures = 0;

for (const pr of manifest.prs) {
  const key = `${pr.repo.replace('/', '__')}__${pr.sha.slice(0, 10)}`;
  const root = path.join(skeletons, key);
  for (const file of pr.files) {
    const target = path.join(root, ...file.path.split('/'));
    const info = await stat(target).catch(() => undefined);
    if (!info || info.size === 0) {
      console.error(`missing corpus file: ${pr.repo}#${pr.number} ${file.path}`);
      verifyFailures += 1;
      continue;
    }
    const digest = createHash('sha256').update(await readFile(target)).digest('hex');
    if (digest !== file.sha256) {
      console.error(`digest mismatch: ${pr.repo}#${pr.number} ${file.path}`);
      verifyFailures += 1;
    }
  }
}

const started = performance.now();
const findings = [];
for (const pr of manifest.prs) {
  const key = `${pr.repo.replace('/', '__')}__${pr.sha.slice(0, 10)}`;
  const root = path.join(skeletons, key);
  const scan = await scanProject({
    root,
    config: { ...DEFAULT_CONFIG, include: pr.files.map((file) => file.path) },
  });
  for (const finding of scan.findings) {
    if (finding.confidence !== 'high') continue;
    findings.push({
      repo: pr.repo,
      number: pr.number,
      language: pr.language,
      agent: pr.agent,
      ruleId: finding.ruleId,
      file: finding.file,
      line: finding.start.line,
      fingerprint: findingFingerprint(finding),
      message: finding.message,
    });
  }
  prs.push({
    repo: pr.repo,
    number: pr.number,
    language: pr.language,
    agent: pr.agent,
    files: pr.files.length,
    high: findings.filter((finding) => finding.repo === pr.repo && finding.number === pr.number).length,
  });
}

const labeled = findings.filter((finding) => finding.fingerprint in labels);
const tp = labeled.filter((finding) => labels[finding.fingerprint].label === 'tp').length;
const fp = labeled.filter((finding) => labels[finding.fingerprint].label === 'fp').length;
const unlabeledHigh = [...new Set(findings.map((finding) => finding.fingerprint))].filter((fingerprint) => !(fingerprint in labels));
const staleLabels = Object.keys(labels).filter((fingerprint) => !findings.some((finding) => finding.fingerprint === fingerprint));

const byRule = {};
for (const finding of findings) {
  const bucket = (byRule[finding.ruleId] ??= { total: 0, tp: 0, fp: 0 });
  bucket.total += 1;
  const label = labels[finding.fingerprint]?.label;
  if (label === 'tp') bucket.tp += 1;
  else if (label === 'fp') bucket.fp += 1;
}

const results = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  slopgateVersion: packageJson.version,
  nodeVersion: process.version,
  corpus: {
    dataset: manifest.dataset,
    prs: manifest.totals.prs,
    files: manifest.totals.files,
    lines: manifest.totals.lines,
    agents: [...new Set(manifest.prs.map((pr) => pr.agent))].sort(),
    languages: [...new Set(manifest.prs.map((pr) => pr.language))].sort(),
    asset: manifest.asset,
  },
  durationMs: Math.round(performance.now() - started),
  high: findings.length,
  labeled: { tp, fp, precision: tp + fp === 0 ? null : tp / (tp + fp) },
  byRule,
  unlabeledHigh,
  staleLabels,
  verifyFailures,
  prs,
  findings,
};

writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n');

const percent = (value) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const lines = [
  '# Real AI pull request corpus',
  '',
  `Generated ${results.generatedAt} with slopgate ${results.slopgateVersion}.`,
  '',
  `- ${manifest.totals.prs} merged pull requests from ${new Set(manifest.prs.map((pr) => pr.repo)).size} repositories`,
  `- ${manifest.totals.files} changed files, ${manifest.totals.lines} lines`,
  `- agents: ${results.corpus.agents.join(', ')}`,
  `- languages: ${results.corpus.languages.join(', ')}`,
  '',
  `**${findings.length} high-confidence findings; labeled precision ${percent(results.labeled.precision)} (${tp} tp, ${fp} fp).**`,
  '',
  '| Rule | High | tp | fp |',
  '| --- | --- | --- | --- |',
  ...Object.entries(byRule)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([rule, counts]) => `| \`${rule}\` | ${counts.total} | ${counts.tp} | ${counts.fp} |`),
  '',
  `Unlabeled high findings: ${unlabeledHigh.length}. Stale labels: ${staleLabels.length}. Missing files: ${verifyFailures}.`,
  '',
];
writeFileSync(reportPath, lines.join('\n'));

console.log(
  `${manifest.totals.prs} PRs, ${findings.length} high, precision ${percent(results.labeled.precision)} (${tp} tp / ${fp} fp), ${results.durationMs}ms`,
);
if (unlabeledHigh.length > 0) console.warn(`high findings without a label: ${unlabeledHigh.length}`);
if (staleLabels.length > 0) console.warn(`stale labels: ${staleLabels.length}`);
if (verifyFailures > 0) console.warn(`corpus files that failed verification: ${verifyFailures}`);
if (unlabeledHigh.length > 0 || staleLabels.length > 0 || verifyFailures > 0) process.exitCode = 1;
