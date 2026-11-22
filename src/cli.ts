#!/usr/bin/env node
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadBaseline, mergeBaseline, partitionByBaseline } from './baseline.ts';
import {
  confidenceRank,
  findConfigRoot,
  findGitRoot,
  loadConfig,
  meetsConfidence,
  type Config,
  type FailOn,
} from './config.ts';
import { assertSafeRef, diffSince, findRepoRoot, isInDiff } from './diff.ts';
import { resolveProjectRoot, isProjectDir } from './deps.ts';
import { scanProject } from './engine.ts';
import { applyFixes } from './fix.ts';
import { serveMcp } from './mcp.ts';
import { renderGithub } from './reporters/github.ts';
import { renderJson } from './reporters/json.ts';
import { renderPretty } from './reporters/pretty.ts';
import { renderSarif } from './reporters/sarif.ts';
import { ALL_RULE_BY_ID, ALL_RULE_METAS } from './rules/index.ts';
import type { Confidence, Finding } from './types.ts';

const FALLBACK_VERSION = '0.2.9';
const DEFAULT_BASELINE = '.slopgate-baseline.json';
const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low'];
const FAIL_ON: readonly FailOn[] = ['high', 'medium', 'low', 'none'];
const FORMATS = ['pretty', 'json', 'sarif', 'github'] as const;
type Format = (typeof FORMATS)[number];

interface Options {
  command: 'scan' | 'rules' | 'init' | 'help' | 'version' | 'mcp';
  paths: string[];
  format: Format;
  confidence: Confidence | undefined;
  failOn: FailOn | undefined;
  baseline: string | undefined;
  writeBaseline: string | undefined;
  diff: string | undefined;
  include: string[];
  exclude: string[];
  rules: string[];
  color: boolean;
  quiet: boolean;
  verbose: boolean;
  force: boolean;
  strict: boolean;
  fix: boolean;
  fixDryRun: boolean;
}

const helpText = (version: string = FALLBACK_VERSION): string => `slopgate ${version} — the slop gate for AI-written code

Usage:
  slopgate [path] [options]                scan a directory or file (default: .)
  slopgate rules                           list every rule
  slopgate mcp [path]                      run as an MCP server on stdio
  slopgate init [--strict]                 add config + GitHub Action
  slopgate --version | --help

Options:
  --format <pretty|json|sarif|github>  output format (default: pretty)
  --confidence <high|medium|low> minimum confidence to show (default: high)
  --fail-on <high|medium|low|none> minimum confidence that fails the run (default: high)
  --baseline [path]              findings file to ignore (default: ${DEFAULT_BASELINE} at the repo root)
  --write-baseline [path]        record current findings as the baseline, then exit 0
  --diff [ref]                   only report findings on lines changed since ref (default: HEAD)
  --include <glob>               extra include pattern (repeatable)
  --exclude <glob>               extra exclude pattern (repeatable)
  --rule <id>                    only run this rule (repeatable)
  --no-color                     disable ANSI colors
  --quiet                        only print the summary
  --verbose                      print config, include, baseline and diff details
  --force                        overwrite files in \`init\`
  --strict                       \`init\`: medium confidence + fail-on medium
  --fix                          apply safe fixes (currently unreachable code)
  --fix-dry-run                  show safe fixes without writing files
  -h, --help                     show this help
  -V, --version                  print the version

Exit codes:
  0  no findings at or above --fail-on
  1  findings at or above --fail-on
  2  usage or configuration error

Suppression:
  # slopgate-ignore-next-line py/noop-test
  // slopgate-ignore-line ts/stub-function
  # slopgate-disable-file

MCP (for coding agents):
  slopgate mcp
  {"mcpServers":{"slopgate":{"command":"npx","args":["-y","@voidh4x0r/slopgate","mcp"]}}}

Docs: https://github.com/VoidH4x0r/slopgate
`;

function defaultOptions(): Options {
  return {
    command: 'scan',
    paths: [],
    format: 'pretty',
    confidence: undefined,
    failOn: undefined,
    baseline: undefined,
    writeBaseline: undefined,
    diff: undefined,
    include: [],
    exclude: [],
    rules: [],
    color: true,
    quiet: false,
    verbose: false,
    force: false,
    strict: false,
    fix: false,
    fixDryRun: false,
  };
}

const VALUE_FLAGS = new Set([
  'format',
  'confidence',
  'fail-on',
  'baseline',
  'write-baseline',
  'diff',
  'include',
  'exclude',
  'rule',
  'paths',
]);

/** `--diff` is the only value flag whose value is optional. */
const OPTIONAL_VALUE_FLAGS = new Set(['diff', 'baseline', 'write-baseline']);

function parseArgs(argv: readonly string[]): { options: Options; error?: string } {
  const options = defaultOptions();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (token === '--') {
      options.paths.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith('-')) {
      if (options.command === 'scan' && options.paths.length === 0 && ['scan', 'rules', 'init', 'mcp', 'help'].includes(token)) {
        options.command = token as Options['command'];
        continue;
      }
      options.paths.push(token);
      continue;
    }

    if (token === '-h' || token === '--help') {
      options.command = 'help';
      continue;
    }
    if (token === '-V' || token === '--version') {
      options.command = 'version';
      continue;
    }
    if (token === '--no-color') {
      options.color = false;
      continue;
    }
    if (token === '--color') {
      options.color = true;
      continue;
    }
    if (token === '--quiet') {
      options.quiet = true;
      continue;
    }
    if (token === '--verbose') {
      options.verbose = true;
      continue;
    }
    if (token === '--force') {
      options.force = true;
      continue;
    }
    if (token === '--fix') {
      options.fix = true;
      continue;
    }
    if (token === '--fix-dry-run') {
      options.fixDryRun = true;
      continue;
    }
    if (token === '--strict') {
      options.strict = true;
      continue;
    }

    const equals = token.indexOf('=');
    const rawName = (equals === -1 ? token : token.slice(0, equals)).replace(/^--?/, '');
    if (!VALUE_FLAGS.has(rawName)) return { options, error: `unknown option: ${token}` };

    let value: string | undefined;
    if (equals !== -1) {
      value = token.slice(equals + 1);
    } else {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('-')) {
        value = next;
        index += 1;
      } else if (!OPTIONAL_VALUE_FLAGS.has(rawName)) {
        return { options, error: `option --${rawName} needs a value` };
      }
    }

    switch (rawName) {
      case 'format':
        if (!value || !FORMATS.includes(value as Format)) {
          return { options, error: `--format must be one of ${FORMATS.join(', ')}` };
        }
        options.format = value as Format;
        break;
      case 'confidence':
        if (!value || !CONFIDENCES.includes(value as Confidence)) {
          return { options, error: `--confidence must be one of ${CONFIDENCES.join(', ')}` };
        }
        options.confidence = value as Confidence;
        break;
      case 'fail-on':
        if (!value || !FAIL_ON.includes(value as FailOn)) {
          return { options, error: `--fail-on must be one of ${FAIL_ON.join(', ')}` };
        }
        options.failOn = value as FailOn;
        break;
      case 'baseline':
        if (value === '') return { options, error: 'option --baseline needs a non-empty path' };
        options.baseline = value ?? DEFAULT_BASELINE;
        break;
      case 'write-baseline':
        if (value === '') return { options, error: 'option --write-baseline needs a non-empty path' };
        options.writeBaseline = value ?? DEFAULT_BASELINE;
        break;
      case 'diff':
        options.diff = value && value.length > 0 ? value : 'HEAD';
        break;
      case 'include':
        if (value === undefined || value === '') {
          return { options, error: 'option --include needs a value' };
        }
        options.include.push(value);
        break;
      case 'exclude':
        if (value === undefined || value === '') {
          return { options, error: 'option --exclude needs a value' };
        }
        options.exclude.push(value);
        break;
      case 'rule':
        if (value === undefined || value === '') {
          return { options, error: 'option --rule needs a value' };
        }
        options.rules.push(value);
        break;
      default:
        break;
    }
  }

  if (options.fix && options.fixDryRun) {
    return { options, error: '--fix and --fix-dry-run cannot be combined' };
  }
  if ((options.fix || options.fixDryRun) && options.writeBaseline !== undefined) {
    return { options, error: '--fix cannot be combined with --write-baseline' };
  }

  return { options };
}

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  isTTY: boolean;
  /** Working directory for relative paths; injectable so tests avoid chdir. */
  cwd: string;
}

/** Real process streams. Tests pass their own collector instead. */
export function defaultIo(): CliIo {
  return {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    isTTY: process.stdout.isTTY === true,
    cwd: process.cwd(),
  };
}

function writeOut(io: CliIo, text: string): void {
  io.out(text.endsWith('\n') ? text : text + '\n');
}

function warn(io: CliIo, options: Options, message: string): void {
  if (!options.quiet) io.err(`slopgate: ${message}\n`);
}

async function runRules(options: Options, io: CliIo): Promise<number> {
  const rows = ALL_RULE_METAS.map((meta) => ({
    id: meta.id,
    severity: meta.severity,
    confidence: meta.confidence,
    languages: meta.languages.join(','),
    title: meta.title,
  }));
  const idWidth = Math.max(...rows.map((row) => row.id.length), 2);
  const sevWidth = Math.max(...rows.map((row) => row.severity.length), 8);
  const confWidth = Math.max(...rows.map((row) => row.confidence.length), 10);
  const langWidth = Math.max(...rows.map((row) => row.languages.length), 9);
  writeOut(
    io,
    `\n${'id'.padEnd(idWidth)}  ${'severity'.padEnd(sevWidth)}  ${'confidence'.padEnd(confWidth)}  ${'languages'.padEnd(langWidth)}  title\n`,
  );
  for (const row of rows) {
    writeOut(
      io,
      `${row.id.padEnd(idWidth)}  ${row.severity.padEnd(sevWidth)}  ${row.confidence.padEnd(confWidth)}  ${row.languages.padEnd(langWidth)}  ${row.title}\n`,
    );
  }
  writeOut(io, '');
  void options;
  return 0;
}

async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

async function readVersion(): Promise<string> {
  try {
    const text = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(text) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

/**
 * Deliberately minimal: everything else falls back to the defaults, and a
 * short config is easier to review than a 20-line dump of glob patterns.
 */
const INIT_CONFIG: Partial<Config> = {
  exclude: [],
  rules: {},
  confidence: 'high',
  failOn: 'high',
};

function initConfig(strict: boolean): Partial<Config> {
  return strict ? { ...INIT_CONFIG, confidence: 'medium', failOn: 'medium' } : INIT_CONFIG;
}

const INIT_WORKFLOW = (version: string, target: string, strict: boolean): string => `name: slopgate

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  slopgate:
    name: slopgate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Scan for AI slop
        run: npx --yes @voidh4x0r/slopgate@${version} ${target} ${strict ? '--confidence medium --fail-on medium' : '--fail-on high'} --format pretty
`;

async function runInit(options: Options, io: CliIo, version: string): Promise<number> {
  const requested = path.resolve(io.cwd, options.paths[0] ?? '.');
  // Find the repo root before creating a directory, so `init newdir` does not
  // leave an empty directory when the config belongs at the root.
  const repoRoot = await findGitRoot(requested);
  await mkdir(requested, { recursive: true });
  const workflowRoot = repoRoot ?? requested;
  const relativeTarget = path.relative(workflowRoot, requested).replace(/\\/g, '/');
  const rawTarget = relativeTarget.length > 0 ? `./${relativeTarget}` : '.';
  const workflowTarget = /\s/.test(rawTarget) ? `"${rawTarget}"` : rawTarget;
  const configPath = path.join(requested, '.slopgate.json');
  const workflowPath = path.join(workflowRoot, '.github', 'workflows', 'slopgate.yml');

  if (!options.force && (await exists(configPath))) {
    warn(io, options, `${path.relative(io.cwd, configPath)} already exists (use --force to overwrite)`);
  } else {
    await writeFile(configPath, JSON.stringify(initConfig(options.strict), null, 2) + '\n', 'utf8');
    writeOut(io, `created ${path.relative(io.cwd, configPath)}`);
  }

  if (!options.force && (await exists(workflowPath))) {
    warn(io, options, `${path.relative(io.cwd, workflowPath)} already exists (use --force to overwrite)`);
  } else {
    await mkdir(path.dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, INIT_WORKFLOW(version, workflowTarget, options.strict), 'utf8');
    writeOut(io, `created ${path.relative(io.cwd, workflowPath)}`);
  }

  const policy = options.strict
    ? '--confidence medium --fail-on medium'
    : '--fail-on high';
  writeOut(
    io,
    `next: npx @voidh4x0r/slopgate ${workflowTarget} ${policy} --write-baseline, then commit the baseline`,
  );
  return 0;
}

interface ScanRun {
  visible: Finding[];
  stats: Awaited<ReturnType<typeof scanProject>>['stats'];
  suppressed: number;
  baselined: number;
  hidden: number;
  onlyDiff: number;
}

async function runMcp(options: Options, cwd: string): Promise<number> {
  const root = path.resolve(cwd, options.paths[0] ?? '.');
  const info = await stat(root).catch(() => undefined);
  if (!info?.isDirectory()) {
    throw new Error(`MCP root is not a directory: ${root}`);
  }
  await serveMcp(root, await readVersion());
  return 0;
}

/** Git root, else cwd when it contains the scan target, else the target itself. */
function scopeBoundary(scanBase: string, repoRoot: string | undefined, cwd: string): string {
  if (repoRoot) return repoRoot;
  const relative = path.relative(cwd, scanBase);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
    ? cwd
    : scanBase;
}

async function runScan(options: Options, io: CliIo): Promise<number> {
  if (options.paths.length > 1) {
    throw new Error('only one path is supported; run slopgate once per path');
  }
  const target = path.resolve(io.cwd, options.paths[0] ?? '.');
  const targetInfo = await stat(target).catch(() => undefined);
  if (!targetInfo) {
    throw new Error(`path not found: ${target}`);
  }
  const scanBase = targetInfo.isFile() ? path.dirname(target) : target;
  const repoRoot = await findGitRoot(scanBase);
  const scopeRoot = scopeBoundary(scanBase, repoRoot, io.cwd);
  const projectRoot = await resolveProjectRoot(scanBase, scopeRoot);
  // In git, a root config applies to every package. Without git, do not let a
  // parent project's config leak across a nested project boundary.
  const configBoundary = repoRoot ?? projectRoot;
  const configRoot = await findConfigRoot(scanBase, configBoundary);
  const reportRoot = repoRoot ?? scanBase;
  const indexRoot = repoRoot ?? ((await isProjectDir(projectRoot)) ? projectRoot : scanBase);
  const { config, file: configFile } = await loadConfig(configRoot);
  const globRoot = configFile ? configRoot : projectRoot;

  if (options.rules.length > 0) {
    const unknown = options.rules.filter((id) => !ALL_RULE_BY_ID.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `unknown rule id: ${unknown.join(', ')} (run \`slopgate rules\` to list the ${ALL_RULE_METAS.length} rule ids)`,
      );
    }
  }

  if (options.diff !== undefined) {
    // Fail fast, before spawning git, on refs that look like options.
    assertSafeRef(options.diff);
  }

  const merged: Config = {
    ...config,
    include: [...config.include, ...options.include],
    exclude: [...config.exclude, ...options.exclude],
  };
  if (options.confidence) merged.confidence = options.confidence;
  if (options.failOn) merged.failOn = options.failOn;

  const result = await scanProject({
    root: target,
    projectRoot,
    configRoot: globRoot,
    indexRoot,
    lookupRoot: scopeRoot,
    reportRoot,
    config: merged,
    ...(options.rules.length > 0 ? { onlyRules: new Set(options.rules) } : {}),
  });

  for (const message of result.warnings) warn(io, options, message);

  if (result.stats.files === 0) {
    throw new Error(
      `no files matched under ${path.relative(io.cwd, target) || '.'} (check include/exclude patterns)`,
    );
  }

  const baselineRoot = repoRoot ?? scanBase;
  const baselinePath = path.resolve(baselineRoot, options.baseline ?? DEFAULT_BASELINE);
  const explicitWrite = options.writeBaseline;
  if (explicitWrite) {
    const writeTarget = path.resolve(baselineRoot, explicitWrite);
    // Only replace entries covered by this scan; a subdirectory or --rule run
    // must not discard the rest of the root baseline.
    const baseline = await mergeBaseline(
      writeTarget,
      result.findings,
      result.files,
      options.rules.length > 0 ? new Set(options.rules) : undefined,
    );
    writeOut(
      io,
      `wrote ${result.findings.length} findings to ${path.relative(io.cwd, writeTarget)} (baseline now ${baseline.entries.length})`,
    );
    return 0;
  }

  let findings: Finding[] = result.findings;
  let onlyDiff = 0;
  if (options.diff !== undefined) {
    const gitRoot = await findRepoRoot(scanBase);
    const set = await diffSince(gitRoot, options.diff);
    const before = findings.length;
    findings = findings.filter((finding) => isInDiff(finding, set));
    onlyDiff = before - findings.length;
  }

  const baseline = (await loadBaseline(baselinePath)) ?? undefined;
  if (baseline === undefined && options.baseline !== undefined) {
    throw new Error(`baseline file not found: ${baselinePath}`);
  }
  // Baseline fingerprints and report paths both use the same root.
  const { fresh, known } = partitionByBaseline(findings, baseline);
  // `--fail-on` below `--confidence` must lower the display threshold too,
  // otherwise the setting can never fail CI (the findings are filtered out).
  const displayConfidence: Confidence =
    merged.failOn === 'none' || confidenceRank(merged.confidence) <= confidenceRank(merged.failOn)
      ? merged.confidence
      : merged.failOn;
  const visible = fresh.filter((finding) => meetsConfidence(finding.confidence, displayConfidence));
  const hidden = fresh.length - visible.length;

  if (options.fix || options.fixDryRun) {
    const visibleSet = new Set(visible);
    const candidates = result.fixes.filter((fix) => visibleSet.has(fix.finding));
    if (candidates.length === 0) {
      if (!options.quiet) io.err('no safe fixes available for the selected findings\n');
    } else {
      const applied = await applyFixes(candidates, { write: options.fix && !options.fixDryRun });
      for (const message of applied.warnings) warn(io, options, message);
      if (!options.quiet) {
        const verb = options.fixDryRun ? 'would fix' : 'fixed';
        io.err(
          `${verb} ${applied.fixedFindings} finding(s) in ${applied.fixedFiles.length} file(s)` +
            (applied.skippedFindings > 0 ? `; skipped ${applied.skippedFindings}` : '') +
            '\n',
        );
      }
      if (!options.fixDryRun && applied.fixedFindings > 0) {
        // Re-scan so positions, baseline and exit code describe the fixed tree.
        return await runScan({ ...options, fix: false, fixDryRun: false }, io);
      }
    }
  }

  const run: ScanRun = {
    visible,
    stats: result.stats,
    suppressed: result.suppressedCount,
    baselined: known.length,
    hidden,
    onlyDiff,
  };

  const version = await readVersion();

  if (options.format === 'json') {
    writeOut(
      io,
      renderJson({
        findings: visible,
        stats: run.stats,
        version,
        suppressedByComment: run.suppressed,
        baselined: run.baselined,
        hiddenByConfidence: run.hidden,
      }),
    );
  } else if (options.format === 'sarif') {
    writeOut(io, renderSarif(visible, version));
  } else if (options.format === 'github') {
    writeOut(io, renderGithub(visible, run.stats));
  } else {
    writeOut(
      io,
      renderPretty({
        findings: visible,
        stats: run.stats,
        suppressedByComment: run.suppressed,
        baselined: run.baselined,
        hiddenByConfidence: run.hidden,
        version,
        color: options.color && io.isTTY && !process.env.NO_COLOR,
        quiet: options.quiet,
      }),
    );
    if (options.verbose) {
      const configLabel = configFile
        ? path.relative(io.cwd, path.join(configRoot, configFile))
        : '(none)';
      writeOut(
        io,
        `  config: ${configLabel}  include: ${merged.include.length} pattern(s)  baseline: ${baseline ? path.relative(io.cwd, baselinePath) : '(none)'}` +
          (onlyDiff > 0 ? `  diff-only: ${onlyDiff} finding(s) outside the diff were ignored` : '') +
          '\n',
      );
    }
  }

  if (merged.failOn === 'none') return 0;
  const failing = visible.some((finding) => meetsConfidence(finding.confidence, merged.failOn as Confidence));
  return failing ? 1 : 0;
}

export async function main(argv: readonly string[], io: CliIo = defaultIo()): Promise<number> {
  const version = await readVersion();
  const { options, error } = parseArgs(argv);
  if (error) {
    io.err(`slopgate: ${error}\n\n${helpText(version)}`);
    return 2;
  }
  if (options.strict && options.command !== 'init' && options.command !== 'help' && options.command !== 'version') {
    warn(io, options, '--strict only affects `init`; use `--confidence medium` for scans');
  }

  try {
    switch (options.command) {
      case 'help':
        writeOut(io, helpText(version));
        return 0;
      case 'version':
        writeOut(io, version);
        return 0;
      case 'rules':
        return await runRules(options, io);
      case 'init':
        return await runInit(options, io, version);
      case 'mcp':
        return await runMcp(options, io.cwd);
      case 'scan':
        return await runScan(options, io);
      default:
        io.err(`slopgate: unknown command\n\n${helpText(version)}`);
        return 2;
    }
  } catch (caught) {
    io.err(`slopgate: ${(caught as Error).message}\n`);
    return 2;
  }
}

const entry = process.argv[1];
if (entry !== undefined) {
  try {
    const [realEntry, self] = await Promise.all([realpath(entry), realpath(fileURLToPath(import.meta.url))]);
    if (realEntry === self) {
      process.exitCode = await main(process.argv.slice(2), defaultIo());
    }
  } catch (error) {
    if (process.env.SLOPGATE_DEBUG) {
      process.stderr.write(`slopgate: entry-point detection failed: ${(error as Error).message}\n`);
    }
    // Imported from another module (or a path we cannot resolve): stay silent.
  }
}
