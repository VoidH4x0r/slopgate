#!/usr/bin/env node
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadBaseline, partitionByBaseline, writeBaseline } from './baseline.ts';
import { loadConfig, meetsConfidence, type Config, type FailOn } from './config.ts';
import { assertSafeRef, diffSince, findRepoRoot, isInDiffWithPrefix } from './diff.ts';
import { scanProject } from './engine.ts';
import { serveMcp } from './mcp.ts';
import { renderGithub } from './reporters/github.ts';
import { renderJson } from './reporters/json.ts';
import { renderPretty } from './reporters/pretty.ts';
import { renderSarif } from './reporters/sarif.ts';
import { ALL_RULES, RULE_BY_ID } from './rules/index.ts';
import type { Confidence, Finding } from './types.ts';

const FALLBACK_VERSION = '0.1.0';
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
}

const HELP = `slopgate ${FALLBACK_VERSION} — the slop gate for AI-written code

Usage:
  slopgate [path] [options]                scan a directory or file (default: .)
  slopgate rules                           list every rule
  slopgate mcp [path]                      run as an MCP server on stdio
  slopgate init                            add config + GitHub Action
  slopgate --version | --help

Options:
  --format <pretty|json|sarif|github>  output format (default: pretty)
  --confidence <high|medium|low> minimum confidence to show (default: high)
  --fail-on <high|medium|low|none> minimum confidence that fails the run (default: high)
  --baseline [path]              findings file to ignore (default: ${DEFAULT_BASELINE})
  --write-baseline [path]        record current findings as the baseline, then exit 0
  --diff [ref]                   only report findings on lines changed since ref (default: HEAD)
  --include <glob>               extra include pattern (repeatable)
  --exclude <glob>               extra exclude pattern (repeatable)
  --rule <id>                    only run this rule (repeatable)
  --no-color                     disable ANSI colors
  --quiet                        only print the summary
  --verbose                      print warnings and per-file details
  --force                        overwrite files in \`init\`
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
  {"mcpServers":{"slopgate":{"command":"npx","args":["-y","slopgate","mcp"]}}}

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
        options.baseline = value ?? DEFAULT_BASELINE;
        break;
      case 'write-baseline':
        options.writeBaseline = value ?? DEFAULT_BASELINE;
        break;
      case 'diff':
        options.diff = value ?? 'HEAD';
        break;
      case 'include':
        if (value) options.include.push(value);
        break;
      case 'exclude':
        if (value) options.exclude.push(value);
        break;
      case 'rule':
        if (value) options.rules.push(value);
        break;
      default:
        break;
    }
  }

  return { options };
}

function writeOut(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}

function warn(options: Options, message: string): void {
  if (!options.quiet) process.stderr.write(`slopgate: ${message}\n`);
}

async function runRules(options: Options): Promise<number> {
  const rows = ALL_RULES.map((rule) => ({
    id: rule.meta.id,
    severity: rule.meta.severity,
    confidence: rule.meta.confidence,
    languages: rule.meta.languages.join(','),
    title: rule.meta.title,
  }));
  const idWidth = Math.max(...rows.map((row) => row.id.length), 2);
  const sevWidth = Math.max(...rows.map((row) => row.severity.length), 8);
  const confWidth = Math.max(...rows.map((row) => row.confidence.length), 10);
  const langWidth = Math.max(...rows.map((row) => row.languages.length), 9);
  writeOut(
    `\n${'id'.padEnd(idWidth)}  ${'severity'.padEnd(sevWidth)}  ${'confidence'.padEnd(confWidth)}  ${'languages'.padEnd(langWidth)}  title\n`,
  );
  for (const row of rows) {
    writeOut(
      `${row.id.padEnd(idWidth)}  ${row.severity.padEnd(sevWidth)}  ${row.confidence.padEnd(confWidth)}  ${row.languages.padEnd(langWidth)}  ${row.title}\n`,
    );
  }
  writeOut('');
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
const INIT_CONFIG = {
  exclude: [],
  rules: {},
  confidence: 'high',
  failOn: 'high',
} satisfies Partial<Config>;

const INIT_WORKFLOW = `name: slopgate

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
        run: npx --yes slopgate@latest . --fail-on high --format pretty
`;

async function runInit(options: Options): Promise<number> {
  const root = path.resolve(options.paths[0] ?? '.');
  await mkdir(root, { recursive: true });
  const configPath = path.join(root, '.slopgate.json');
  const workflowPath = path.join(root, '.github', 'workflows', 'slopgate.yml');

  if (!options.force && (await exists(configPath))) {
    warn(options, `${configPath} already exists (use --force to overwrite)`);
  } else {
    await writeFile(configPath, JSON.stringify(INIT_CONFIG, null, 2) + '\n', 'utf8');
    writeOut(`created ${path.relative(process.cwd(), configPath)}`);
  }

  if (!options.force && (await exists(workflowPath))) {
    warn(options, `${workflowPath} already exists (use --force to overwrite)`);
  } else {
    await mkdir(path.dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, INIT_WORKFLOW, 'utf8');
    writeOut(`created ${path.relative(process.cwd(), workflowPath)}`);
  }

  writeOut('next: npx slopgate . --write-baseline, then commit the baseline');
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

async function runMcp(options: Options): Promise<number> {
  const root = path.resolve(options.paths[0] ?? '.');
  const info = await stat(root).catch(() => undefined);
  if (!info?.isDirectory()) {
    throw new Error(`MCP root is not a directory: ${root}`);
  }
  await serveMcp(root, await readVersion());
  return 0;
}

async function runScan(options: Options): Promise<number> {
  if (options.paths.length > 1) {
    throw new Error('only one path is supported; run slopgate once per path');
  }
  const target = path.resolve(options.paths[0] ?? '.');
  const targetInfo = await stat(target).catch(() => undefined);
  if (!targetInfo) {
    throw new Error(`path not found: ${target}`);
  }
  const projectRoot = targetInfo.isFile() ? path.dirname(target) : target;
  const { config, file: configFile } = await loadConfig(projectRoot);

  if (options.rules.length > 0) {
    const unknown = options.rules.filter((id) => !RULE_BY_ID.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `unknown rule id: ${unknown.join(', ')} (run \`slopgate rules\` to list the ${ALL_RULES.length} rule ids)`,
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
    config: merged,
    ...(options.rules.length > 0 ? { onlyRules: new Set(options.rules) } : {}),
  });

  if (result.stats.files === 0) {
    warn(
      options,
      `no files matched under ${path.relative(process.cwd(), target) || '.'} (check include/exclude patterns)`,
    );
  }

  for (const message of result.warnings) warn(options, message);

  let findings: Finding[] = result.findings;
  let onlyDiff = 0;
  if (options.diff !== undefined) {
    // git paths are relative to the repository root, not to the scan target.
    const repoRoot = await findRepoRoot(projectRoot);
    const set = await diffSince(repoRoot, options.diff);
    const prefix = path.relative(repoRoot, target);
    const before = findings.length;
    findings = findings.filter((finding) => isInDiffWithPrefix(finding, set, prefix));
    onlyDiff = before - findings.length;
  }

  const baselinePath = path.resolve(projectRoot, options.baseline ?? DEFAULT_BASELINE);
  const explicitWrite = options.writeBaseline;
  if (explicitWrite) {
    const writeTarget = path.resolve(projectRoot, explicitWrite);
    await writeBaseline(writeTarget, findings);
    writeOut(`wrote ${findings.length} findings to ${path.relative(process.cwd(), writeTarget)}`);
    return 0;
  }

  const baseline = (await loadBaseline(baselinePath)) ?? undefined;
  if (baseline === undefined && options.baseline !== undefined) {
    throw new Error(`baseline file not found: ${baselinePath}`);
  }
  const { fresh, known } = partitionByBaseline(findings, baseline);
  const visible = fresh.filter((finding) => meetsConfidence(finding.confidence, merged.confidence));
  const hidden = fresh.length - visible.length;

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
    writeOut(renderSarif(visible, version));
  } else if (options.format === 'github') {
    writeOut(renderGithub(visible, run.stats));
  } else {
    writeOut(
      renderPretty({
        findings: visible,
        stats: run.stats,
        suppressedByComment: run.suppressed,
        baselined: run.baselined,
        hiddenByConfidence: run.hidden,
        version,
        color: options.color && process.stdout.isTTY === true && !process.env.NO_COLOR,
        quiet: options.quiet,
      }),
    );
    if (options.verbose) {
      writeOut(
        `  config: ${configFile ?? '(none)'}  baseline: ${baseline ? path.relative(process.cwd(), baselinePath) : '(none)'}` +
          (onlyDiff > 0 ? `  diff-only: ${onlyDiff} finding(s) outside the diff were ignored` : '') +
          '\n',
      );
    }
  }

  if (merged.failOn === 'none') return 0;
  const failing = visible.some((finding) => meetsConfidence(finding.confidence, merged.failOn as Confidence));
  return failing ? 1 : 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  const { options, error } = parseArgs(argv);
  if (error) {
    process.stderr.write(`slopgate: ${error}\n\n${HELP}`);
    return 2;
  }

  try {
    switch (options.command) {
      case 'help':
        writeOut(HELP);
        return 0;
      case 'version':
        writeOut(await readVersion());
        return 0;
      case 'rules':
        return await runRules(options);
      case 'init':
        return await runInit(options);
      case 'mcp':
        return await runMcp(options);
      case 'scan':
        return await runScan(options);
      default:
        process.stderr.write(`slopgate: unknown command\n\n${HELP}`);
        return 2;
    }
  } catch (caught) {
    process.stderr.write(`slopgate: ${(caught as Error).message}\n`);
    return 2;
  }
}

const entry = process.argv[1];
if (entry !== undefined) {
  try {
    const [realEntry, self] = await Promise.all([realpath(entry), realpath(fileURLToPath(import.meta.url))]);
    if (realEntry === self) {
      process.exitCode = await main(process.argv.slice(2));
    }
  } catch (error) {
    if (process.env.SLOPGATE_DEBUG) {
      process.stderr.write(`slopgate: entry-point detection failed: ${(error as Error).message}\n`);
    }
    // Imported from another module (or a path we cannot resolve): stay silent.
  }
}
