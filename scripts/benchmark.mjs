#!/usr/bin/env node
/**
 * Reproducible precision benchmark.
 *
 *   node scripts/benchmark.mjs --corpus cpython=C:/Python3/Lib
 *   node scripts/benchmark.mjs --corpus cpython=... --out benchmark/results.json --report benchmark/report.md
 *
 * Requires `npm run build` first: it measures the artifact users actually run.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findingFingerprint } from '../dist/baseline.js';
import { DEFAULT_CONFIG } from '../dist/config.js';
import { scanProject } from '../dist/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function parseArgs(argv) {
  const options = { corpora: [], out: 'benchmark/results.json', report: 'benchmark/report.md', labels: 'benchmark/labels.json', seeded: 'benchmark/seeded.json' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--corpus') {
      const value = argv[i + 1] ?? '';
      i += 1;
      const [name, dir] = value.split('=');
      if (!name || !dir) throw new Error('--corpus expects name=/path');
      options.corpora.push({ name, dir });
    } else if (token === '--out') { options.out = argv[++i]; }
    else if (token === '--report') { options.report = argv[++i]; }
    else if (token === '--labels') { options.labels = argv[++i]; }
    else if (token === '--seeded') { options.seeded = argv[++i]; }
    else if (token === '--help' || token === '-h') { console.log('usage: node scripts/benchmark.mjs --corpus name=/path [--corpus ...] [--out file] [--report file]'); process.exit(0); }
    else throw new Error(`unknown option: ${token}`);
  }
  if (options.corpora.length === 0) throw new Error('at least one --corpus name=/path is required');
  return options;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'venv', '.venv', '__pycache__', '.mypy_cache', 'site-packages', 'coverage']);
const SOURCE_EXT = /\.(py|pyi|ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

async function countLines(dir) {
  let files = 0;
  let lines = 0;
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(abs);
        continue;
      }
      if (!SOURCE_EXT.test(entry.name) || entry.name.endsWith('.d.ts') || entry.name.endsWith('.min.js')) continue;
      try {
        const info = await stat(abs);
        if (info.size > 1024 * 1024) continue;
        const text = await readFile(abs, 'utf8');
        files += 1;
        lines += text.split(/\r?\n/).length;
      } catch {
        continue;
      }
    }
  }
  await walk(dir);
  return { files, lines };
}

function loadJson(file, fallback) {
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!existsSync(abs)) return fallback;
  return JSON.parse(readFileSync(abs, 'utf8'));
}

function summarize(findings) {
  const byRule = {};
  for (const finding of findings) {
    const bucket = (byRule[finding.ruleId] ??= { high: 0, medium: 0, low: 0 });
    bucket[finding.confidence] += 1;
  }
  return byRule;
}

function precisionFor(allFindings, labels) {
  // The published claim is about high confidence only.
  const findings = allFindings.filter((finding) => finding.confidence === 'high');
  const perRule = {};
  const overall = { tp: 0, fp: 0 };
  for (const finding of findings) {
    const label = labels[findingFingerprint(finding)];
    if (!label) continue;
    const bucket = (perRule[finding.ruleId] ??= { tp: 0, fp: 0 });
    if (label.label === 'tp') { bucket.tp += 1; overall.tp += 1; } else if (label.label === 'fp') { bucket.fp += 1; overall.fp += 1; }
  }
  const ratio = (counts) => (counts.tp + counts.fp === 0 ? null : counts.tp / (counts.tp + counts.fp));
  return {
    overall: { ...overall, precision: ratio(overall) },
    byRule: Object.fromEntries(Object.entries(perRule).map(([rule, counts]) => [rule, { ...counts, precision: ratio(counts) }])),
  };
}

async function recallAgainstSeeded(seeded) {
  const fixtureRoot = path.join(ROOT, seeded.fixture);
  const result = await scanProject({ root: fixtureRoot, config: { ...DEFAULT_CONFIG } });
  const found = new Set(result.findings.map((finding) => `${finding.file}|${finding.ruleId}`));
  const expected = seeded.expected;
  const hits = expected.filter((entry) => found.has(`${entry.file}|${entry.ruleId}`));
  return { total: expected.length, detected: hits.length, missed: expected.filter((entry) => !hits.includes(entry)) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(ROOT, 'dist', 'engine.js'))) {
    throw new Error('dist/ is missing. Run `npm run build` first.');
  }
  const labels = loadJson(options.labels, {});
  const seeded = loadJson(options.seeded, undefined);
  const report = { generatedAt: new Date().toISOString(), corpora: [] };

  for (const corpus of options.corpora) {
    const started = performance.now();
    const scan = await scanProject({ root: corpus.dir, config: { ...DEFAULT_CONFIG } });
    const durationMs = Math.round(performance.now() - started);
    const loc = await countLines(corpus.dir);
    const high = scan.findings.filter((finding) => finding.confidence === 'high');
    report.corpora.push({
      name: corpus.name,
      files: scan.stats.files,
      lines: loc.lines,
      durationMs,
      findings: scan.findings.length,
      high: high.length,
      suppressed: scan.suppressedCount,
      parseErrors: scan.stats.parseErrors,
      byRule: summarize(scan.findings),
      precision: precisionFor(scan.findings, labels),
      findingsList: high.map((finding) => ({
        fingerprint: findingFingerprint(finding),
        ruleId: finding.ruleId,
        file: finding.file,
        line: finding.start.line,
        confidence: finding.confidence,
        snippet: finding.snippet,
      })),
    });
  }

  if (seeded) report.recall = await recallAgainstSeeded(seeded);

  const outPath = path.resolve(ROOT, options.out);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  const reportPath = path.resolve(ROOT, options.report);
  writeFileSync(reportPath, renderMarkdown(report), 'utf8');

  for (const corpus of report.corpora) {
    const perKloc = corpus.lines > 0 ? ((corpus.high / corpus.lines) * 1000).toFixed(2) : 'n/a';
    const precision = corpus.precision.overall.precision;
    console.log(
      `${corpus.name}: ${corpus.files} files, ${corpus.lines} lines | ${corpus.high} high (${perKloc}/kLOC) | precision ${precision === null ? 'unlabeled' : (precision * 100).toFixed(1) + '%'}`,
    );
  }
  if (report.recall) console.log(`recall (seeded): ${report.recall.detected}/${report.recall.total}`);
  console.log(`wrote ${path.relative(ROOT, outPath)} and ${path.relative(ROOT, reportPath)}`);
}

function percent(value) {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Benchmark report', '');
  lines.push(`Generated ${report.generatedAt} by \`scripts/benchmark.mjs\`.`, '');
  lines.push('## Summary', '');
  lines.push('| Corpus | Files | Lines | High findings | High / kLOC | Precision (labeled) |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const corpus of report.corpora) {
    const perKloc = corpus.lines > 0 ? ((corpus.high / corpus.lines) * 1000).toFixed(2) : '—';
    lines.push(
      `| ${corpus.name} | ${corpus.files} | ${corpus.lines} | ${corpus.high} | ${perKloc} | ${percent(corpus.precision.overall.precision)} |`,
    );
  }
  lines.push('');
  if (report.recall) {
    lines.push('## Recall (seeded defects)', '');
    lines.push(`Detected **${report.recall.detected}/${report.recall.total}** seeded defects.`);
    if (report.recall.missed.length > 0) {
      lines.push('', 'Missed:', '');
      for (const miss of report.recall.missed) lines.push(`- \`${miss.ruleId}\` in \`${miss.file}\``);
    }
    lines.push('');
  }
  for (const corpus of report.corpora) {
    lines.push(`## ${corpus.name}`, '');
    lines.push(`Scanned **${corpus.files}** files (**${corpus.lines}** lines) in ${corpus.durationMs} ms.`);
    lines.push('');
    lines.push('| Rule | high | medium | low | Labeled | Precision |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const [rule, counts] of Object.entries(corpus.byRule).sort()) {
      const precision = corpus.precision.byRule[rule];
      const labeled = precision ? precision.tp + precision.fp : 0;
      lines.push(
        `| \`${rule}\` | ${counts.high} | ${counts.medium} | ${counts.low} | ${labeled} | ${percent(precision?.precision ?? null)} |`,
      );
    }
    lines.push('');
  }
  lines.push('## Method', '');
  lines.push(
    'Corpora are pinned checkouts of real repositories. Every finding at `high` confidence is labeled in `benchmark/labels.json` as `tp` (the described pattern is present in the code as written) or `fp` (the report is misleading). Precision is `tp / (tp + fp)` over labeled findings; unlabeled findings are excluded from the ratio but shown in the counts.',
  );
  lines.push('');
  lines.push(
    'The corpus is deliberately adversarial: CPython\'s own test suite is full of helper functions named `test_*` and intentional no-op implementations, which is where the `noop-test` false positives come from.',
  );
  lines.push('');
  return lines.join('\n');
}

await main();
