import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { loadBaseline, partitionByBaseline } from './baseline.ts';
import {
  findConfigRoot,
  findGitRoot,
  loadConfig,
  meetsConfidence,
  type Config,
} from './config.ts';
import { diffSince, isInDiff, type DiffSet } from './diff.ts';
import { resolveProjectRoot } from './deps.ts';
import { scanProject, type ScanResult } from './engine.ts';
import { ALL_RULES } from './rules/index.ts';
import type { Confidence, Finding } from './types.ts';

/**
 * Minimal Model Context Protocol server over stdio.
 *
 * Transport: newline-delimited JSON-RPC 2.0 (MCP stdio transport). Nothing is
 * ever written to stdout except protocol messages.
 */

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface McpDeps {
  root: string;
  version: string;
  config: Config;
  /** Resolve the nearest config for a scan target; falls back to `config`. */
  configFor?: (root: string) => Promise<Config>;
  scan: (root: string) => Promise<ScanResult>;
  diff: (root: string, base: string) => Promise<DiffSet>;
}

const PROTOCOL_FALLBACK = '2024-11-05';
const MAX_FINDINGS = 50;

const TOOLS = [
  {
    name: 'scan_diff',
    description:
      'Run slopgate on the lines changed since a git ref (default HEAD). Use this before finishing a task to check that the new code does not contain hallucinated imports, empty stubs, tests that cannot fail, swallowed errors or dead code.',
    inputSchema: {
      type: 'object',
      properties: {
        base: { type: 'string', description: 'Git ref to compare against (default: HEAD)' },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Minimum confidence to report (default: high)',
        },
        maxFindings: { type: 'integer', description: 'Maximum findings to print (default: 50)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'scan_path',
    description:
      'Run slopgate over a directory or file. Returns findings with rule id, confidence and evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory, relative to the repository root' },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Minimum confidence to report (default: high)',
        },
        maxFindings: { type: 'integer', description: 'Maximum findings to print (default: 50)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_rules',
    description: 'List the rules slopgate can report, with their default severity and confidence.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** True when `candidate` is `root` itself or lives below it. */
export function isInsideRoot(realRoot: string, candidate: string): boolean {
  const relative = path.relative(realRoot, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function textResult(text: string, isError = false): unknown {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function coerceConfidence(value: unknown, fallback: Confidence): Confidence {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return fallback;
}

function coerceNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), MAX_FINDINGS)
    : fallback;
}

function formatFindings(
  findings: Finding[],
  result: ScanResult,
  version: string,
  max: number,
  preamble?: string,
): string {
  const shown = findings.slice(0, max);
  const errors = findings.filter((finding) => finding.severity === 'error').length;
  const lines: string[] = [];
  if (preamble) lines.push(preamble);
  lines.push(
    `slopgate ${version} · ${findings.length} finding(s) (${errors} error) · ${result.stats.files} files scanned in ${result.stats.durationMs}ms`,
  );
  if (findings.length === 0) {
    lines.push('No findings above the confidence threshold.');
    return lines.join('\n');
  }
  if (findings.length > shown.length) {
    lines.push(`Showing the first ${shown.length} of ${findings.length}.`);
  }
  for (const finding of shown) {
    lines.push(
      `${finding.file}:${finding.start.line}:${finding.start.column}  ${finding.severity}  ${finding.confidence}  ${finding.ruleId}  ${finding.message}`,
    );
    if (finding.snippet) lines.push(`    ${finding.snippet}`);
    for (const item of finding.evidence.slice(0, 2)) lines.push(`    - ${item}`);
  }
  return lines.join('\n');
}

function prefixForRoot(root: string, base: string): string {
  const relative = path.relative(root, base);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '';
  return relative.replace(/\\/g, '/');
}

export function createMcpServer(deps: McpDeps) {
  async function callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    if (name === 'list_rules') {
      const lines = ['id\tseverity\tconfidence\tlanguages\ttitle'];
      for (const rule of ALL_RULES) {
        lines.push(
          `${rule.meta.id}\t${rule.meta.severity}\t${rule.meta.confidence}\t${rule.meta.languages.join(',')}\t${rule.meta.title}`,
        );
      }
      return textResult(lines.join('\n'));
    }

    const max = coerceNumber(params.maxFindings, MAX_FINDINGS);
    const configFor = deps.configFor ?? (async () => deps.config);

    if (name === 'scan_path') {
      const target = path.resolve(deps.root, typeof params.path === 'string' ? params.path : '.');
      if (!isInsideRoot(deps.root, target)) {
        return textResult(`Refusing to scan outside the repository root: ${target}`, true);
      }
      // `path.resolve` does not follow symlinks: a link inside the root could
      // still point outside it, so compare real paths as well.
      const realRoot = await realpath(deps.root).catch(() => deps.root);
      const realTarget = await realpath(target).catch(() => target);
      if (!isInsideRoot(realRoot, realTarget)) {
        return textResult(`Refusing to scan outside the repository root: ${target}`, true);
      }
      const targetConfig = await configFor(target);
      const confidence = coerceConfidence(params.confidence, targetConfig.confidence);
      const result = await deps.scan(target);
      if (result.stats.files === 0) {
        return textResult(`No files matched under ${target} (check include/exclude patterns)`, true);
      }
      const visible = result.findings.filter((finding) => meetsConfidence(finding.confidence, confidence));
      return textResult(formatFindings(visible, result, deps.version, max));
    }

    if (name === 'scan_diff') {
      const base = typeof params.base === 'string' && params.base.length > 0 ? params.base : 'HEAD';
      const rootConfig = await configFor(deps.root);
      const confidence = coerceConfidence(params.confidence, rootConfig.confidence);
      const result = await deps.scan(deps.root);
      if (result.stats.files === 0) {
        return textResult('No files matched in the repository (check include/exclude patterns)', true);
      }
      const set = await deps.diff(deps.root, base);
      const inDiff = result.findings.filter(
        (finding) => isInDiff(finding, set) && meetsConfidence(finding.confidence, confidence),
      );
      const preamble = `Diff since ${base}: ${inDiff.length} finding(s) on changed lines.`;
      return textResult(formatFindings(inDiff, result, deps.version, max, preamble));
    }

    return textResult(`Unknown tool: ${name}`, true);
  }

  return {
    async handle(line: string): Promise<JsonRpcResponse | null> {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line) as JsonRpcRequest;
      } catch {
        return fail(null, -32700, 'Parse error');
      }
      if (request === null || typeof request !== 'object' || typeof request.method !== 'string') {
        return fail(null, -32600, 'Invalid request');
      }

      const isNotification = request.id === undefined || request.id === null;
      const id = request.id ?? null;

      try {
        switch (request.method) {
          case 'initialize': {
            const requested = (request.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
            return ok(id, {
              protocolVersion: typeof requested === 'string' ? requested : PROTOCOL_FALLBACK,
              capabilities: { tools: {} },
              serverInfo: { name: 'slopgate', version: deps.version },
            });
          }
          case 'notifications/initialized':
            return null;
          case 'ping':
            return ok(id, {});
          case 'tools/list':
            return ok(id, { tools: TOOLS });
          case 'tools/call': {
            const params = (request.params ?? {}) as { name?: unknown; arguments?: unknown };
            if (typeof params.name !== 'string') return fail(id, -32602, 'tools/call requires a tool name');
            const args =
              params.arguments !== null && typeof params.arguments === 'object'
                ? (params.arguments as Record<string, unknown>)
                : {};
            const result = await callTool(params.name, args);
            return ok(id, result);
          }
          default:
            return isNotification ? null : fail(id, -32601, `Method not found: ${request.method}`);
        }
      } catch (error) {
        const message = (error as Error).message;
        if (request.method === 'tools/call') {
          return ok(id, textResult(`slopgate error: ${message}`, true));
        }
        return fail(id, -32603, message);
      }
    },
  };
}

export function defaultMcpDeps(root: string, version: string): Omit<McpDeps, 'config'> {
  const configCache = new Map<string, Promise<Config>>();
  const configFor = async (start: string): Promise<Config> => {
    const target = path.resolve(start);
    const repoRoot = (await findGitRoot(target)) ?? root;
    const configRoot = await findConfigRoot(target, repoRoot);
    let pending = configCache.get(configRoot);
    if (!pending) {
      pending = loadConfig(configRoot).then((loaded) => loaded.config);
      configCache.set(configRoot, pending);
    }
    return pending;
  };

  return {
    root,
    version,
    configFor,
    async scan(scanRoot: string) {
      const config = await configFor(scanRoot);

      // Findings and baseline fingerprints are MCP-root-relative. Normalize
      // here, before partitioning, so a root baseline matches subdirectory and
      // single-file scans too.
      const target = path.resolve(scanRoot);
      const info = await stat(target).catch(() => undefined);
      const base = info?.isFile() ? path.dirname(target) : target;
      const repoRoot = (await findGitRoot(base)) ?? root;
      const projectRoot = await resolveProjectRoot(base, repoRoot);
      const result = await scanProject({ root: target, projectRoot, config });

      const prefix = prefixForRoot(root, base);
      const normalized = prefix
        ? result.findings.map((finding) => ({ ...finding, file: `${prefix}/${finding.file}` }))
        : result.findings;

      // Respect a baseline if one exists, so agents do not re-report known debt.
      const baseline = await loadBaseline(path.join(root, '.slopgate-baseline.json'));
      if (baseline) {
        return { ...result, findings: partitionByBaseline(normalized, baseline).fresh };
      }
      return { ...result, findings: normalized };
    },
    diff: diffSince,
  };
}

/** Runs the stdio loop. Resolves when stdin closes. */
export async function serveMcp(root: string, version: string): Promise<void> {
  const config = (await loadConfig(root)).config;
  const base = defaultMcpDeps(root, version);
  const server = createMcpServer({ ...base, config });

  process.stderr.write(`slopgate mcp ${version} ready (root: ${root})\n`);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim().length === 0) continue;
    const response = await server.handle(line);
    if (response !== null) process.stdout.write(JSON.stringify(response) + '\n');
  }
}
