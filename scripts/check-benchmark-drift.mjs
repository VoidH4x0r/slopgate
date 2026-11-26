#!/usr/bin/env node
/**
 * Compare a fresh benchmark result with the committed baseline.
 *
 * The scheduled benchmark exists to notice drift on a fixed corpus and a fixed
 * toolchain: the same tree must keep producing the same high-confidence count,
 * the same label reconciliation, the same seeded recall, and a comparable
 * parse-error rate and scan duration. This script reports every difference and
 * exits non-zero when anything moved.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const options = {
    newFile: undefined,
    baseline: undefined,
    maxParseErrorDrift: 5,
    maxDurationMs: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--new') options.newFile = argv[++i];
    else if (token === '--baseline') options.baseline = argv[++i];
    else if (token === '--max-parse-error-drift') options.maxParseErrorDrift = Number(argv[++i]);
    else if (token === '--max-duration-ms') options.maxDurationMs = Number(argv[++i]);
    else if (token === '--help' || token === '-h') {
      console.log(
        'usage: node scripts/check-benchmark-drift.mjs --new <results.json> --baseline <results.json> ' +
          '[--max-parse-error-drift percent] [--max-duration-ms ms]',
      );
      process.exit(0);
    } else throw new Error(`unknown option: ${token}`);
  }
  if (!options.newFile || !options.baseline) throw new Error('--new and --baseline are required');
  if (!Number.isFinite(options.maxParseErrorDrift) || options.maxParseErrorDrift < 0) {
    throw new Error('--max-parse-error-drift expects a non-negative percentage');
  }
  if (options.maxDurationMs !== undefined && (!Number.isFinite(options.maxDurationMs) || options.maxDurationMs < 0)) {
    throw new Error('--max-duration-ms expects a non-negative number');
  }
  return options;
}

function corpusMap(report) {
  const map = new Map();
  for (const corpus of report.corpora ?? []) map.set(corpus.name, corpus);
  return map;
}

/**
 * Return a list of human-readable drift problems. An empty list means the new
 * run reproduces the baseline exactly.
 */
export function compareResults(current, baseline, options = {}) {
  const problems = [];
  const maxParseErrorDrift = options.maxParseErrorDrift ?? 5;
  const maxDurationMs = options.maxDurationMs;
  const currentMap = corpusMap(current);
  const baselineMap = corpusMap(baseline);

  for (const name of baselineMap.keys()) {
    if (!currentMap.has(name)) problems.push(`corpus missing from the new run: ${name}`);
  }
  for (const name of currentMap.keys()) {
    if (!baselineMap.has(name)) problems.push(`unexpected corpus in the new run: ${name}`);
  }

  for (const [name, expected] of baselineMap) {
    const actual = currentMap.get(name);
    if (!actual) continue;

    if (actual.digest !== expected.digest) {
      problems.push(
        `${name}: corpus digest changed (${expected.digest} -> ${actual.digest}); the new run is not on the baseline tree`,
      );
    }
    if (actual.files !== expected.files) {
      problems.push(`${name}: file count changed (${expected.files} -> ${actual.files})`);
    }
    if (actual.high !== expected.high) {
      problems.push(`${name}: high-confidence count changed (${expected.high} -> ${actual.high})`);
    }

    const expectedPrecision = expected.precision?.overall ?? {};
    const actualPrecision = actual.precision?.overall ?? {};
    const expectedTp = expectedPrecision.tp ?? 0;
    const expectedFp = expectedPrecision.fp ?? 0;
    const actualTp = actualPrecision.tp ?? 0;
    const actualFp = actualPrecision.fp ?? 0;
    if (actualTp !== expectedTp || actualFp !== expectedFp) {
      problems.push(`${name}: labeled precision changed (tp/fp ${expectedTp}/${expectedFp} -> ${actualTp}/${actualFp})`);
    }

    if (maxDurationMs !== undefined && name === 'cpython-stdlib' && actual.durationMs > maxDurationMs) {
      problems.push(`${name}: ${actual.durationMs}ms exceeds the ${maxDurationMs}ms budget`);
    }

    const expectedErrors = expected.parseErrors ?? 0;
    const actualErrors = actual.parseErrors ?? 0;
    if (expectedErrors > 0) {
      const allowed = Math.ceil((expectedErrors * maxParseErrorDrift) / 100);
      if (Math.abs(actualErrors - expectedErrors) > allowed) {
        problems.push(
          `${name}: parse errors drifted (${expectedErrors} -> ${actualErrors}; allowed ±${maxParseErrorDrift}%)`,
        );
      }
    }
  }

  if ((current.staleLabels ?? []).length > 0) {
    problems.push(`${current.staleLabels.length} stale label(s) in the new run`);
  }
  if ((current.unlabeledHigh ?? []).length > 0) {
    problems.push(`${current.unlabeledHigh.length} high finding(s) without a label in the new run`);
  }

  if (current.recall && baseline.recall) {
    if (current.recall.total !== baseline.recall.total || current.recall.detected !== baseline.recall.detected) {
      problems.push(
        `seeded recall changed (${baseline.recall.detected}/${baseline.recall.total} -> ${current.recall.detected}/${current.recall.total})`,
      );
    }
  }

  return problems;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read JSON from ${file}: ${reason}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const current = readJson(options.newFile);
  const baseline = readJson(options.baseline);
  const problems = compareResults(current, baseline, {
    maxParseErrorDrift: options.maxParseErrorDrift,
    maxDurationMs: options.maxDurationMs,
  });
  if (problems.length > 0) {
    console.error(`benchmark drift: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  const names = (current.corpora ?? []).map((corpus) => corpus.name).join(', ');
  console.log(`benchmark drift OK: ${names}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`check-benchmark-drift: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
