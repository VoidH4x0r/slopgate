import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { loadBaseline, partitionByBaseline } from './baseline.ts';
import {
  CONFIG_FILENAMES,
  findConfigRoot,
  findGitRoot,
  loadConfig,
  meetsConfidence,
  type Config,
} from './config.ts';
import { diffSince, findRepoRoot, isInDiffWithPrefix, type DiffSet } from './diff.ts';
import { resolveProjectRoot } from './deps.ts';
import { scanProject, type ScanResult } from './engine.ts';
import { applyFixes } from './fix.ts';
import { ALL_RULE_METAS } from './rules/index.ts';
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
  scan: (root: string, confidence?: Confidence) => Promise<ScanResult>;
  diff: (root: string, base: string) => Promise<DiffSet>;
}

const PROTOCOL_FALLBACK = '2024-11-05';
const PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
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
  {
    name: 'explain_rule',
    description: 'Return the title, summary, severity, confidence and languages for one rule id.',
    inputSchema: {
      type: 'object',
      properties: { ruleId: { type: 'string', description: 'Rule id such as py/noop-test' } },
      required: ['ruleId'],
      additionalProperties: false,
    },
  },
  {
    name: 'preview_fix',
    description:
      'Show the safe fixes that --fix would apply under a path, without writing any file. The safe subset is unreachable code after return/raise/break/continue.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory, relative to the repository root' },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Minimum confidence to consider (default: high)',
        },
      },
      additionalProperties: false,
    },
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
  const escapes =
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  return relative === '' || !escapes;
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
    for (const warning of result.warnings.slice(0, 5)) lines.push(`warning: ${warning}`);
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
  for (const warning of result.warnings.slice(0, 5)) lines.push(`warning: ${warning}`);
  return lines.join('\n');
}

export function createMcpServer(deps: McpDeps) {
  async function callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    if (name === 'list_rules') {
      const lines = ['id\tseverity\tconfidence\tlanguages\ttitle'];
      for (const meta of ALL_RULE_METAS) {
        lines.push(
          `${meta.id}\t${meta.severity}\t${meta.confidence}\t${meta.languages.join(',')}\t${meta.title}`,
        );
      }
      return textResult(lines.join('\n'));
    }

    if (name === 'explain_rule') {
      const ruleId = typeof params.ruleId === 'string' ? params.ruleId : '';
      const meta = ALL_RULE_METAS.find((candidate) => candidate.id === ruleId);
      if (!meta) return textResult(`Unknown rule: ${ruleId || '(missing ruleId)'}`, true);
      return textResult(
        [
          `id: ${meta.id}`,
          `title: ${meta.title}`,
          `summary: ${meta.summary}`,
          `severity: ${meta.severity}`,
          `confidence: ${meta.confidence}`,
          `languages: ${meta.languages.join(', ')}`,
          `tags: ${meta.tags.join(', ')}`,
        ].join('\n'),
      );
    }

    const max = coerceNumber(params.maxFindings, MAX_FINDINGS);
    const configFor = deps.configFor ?? (async () => deps.config);

    if (name === 'scan_path') {
      if (params.path !== undefined && typeof params.path !== 'string') {
        return textResult('scan_path requires a string path', true);
      }
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
      const result = await deps.scan(target, confidence);
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
      const result = await deps.scan(deps.root, confidence);
      if (result.stats.files === 0) {
        return textResult('No files matched in the repository (check include/exclude patterns)', true);
      }
      const set = await deps.diff(deps.root, base);
      const repoRoot = await findRepoRoot(deps.root).catch(() => deps.root);
      const prefix = path.relative(repoRoot, deps.root);
      const inDiff = result.findings.filter(
        (finding) =>
          isInDiffWithPrefix(finding, set, prefix) && meetsConfidence(finding.confidence, confidence),
      );
      const preamble = `Diff since ${base}: ${inDiff.length} finding(s) on changed lines.`;
      return textResult(formatFindings(inDiff, result, deps.version, max, preamble));
    }

    if (name === 'preview_fix') {
      if (params.path !== undefined && typeof params.path !== 'string') {
        return textResult('preview_fix requires a string path', true);
      }
      const target = path.resolve(deps.root, typeof params.path === 'string' ? params.path : '.');
      if (!isInsideRoot(deps.root, target)) {
        return textResult(`Refusing to scan outside the repository root: ${target}`, true);
      }
      const realRoot = await realpath(deps.root).catch(() => deps.root);
      const realTarget = await realpath(target).catch(() => target);
      if (!isInsideRoot(realRoot, realTarget)) {
        return textResult(`Refusing to scan outside the repository root: ${target}`, true);
      }
      const targetConfig = await configFor(target);
      const confidence = coerceConfidence(params.confidence, targetConfig.confidence);
      const result = await deps.scan(target, confidence);
      if (result.stats.files === 0) {
        return textResult(`No files matched under ${target} (check include/exclude patterns)`, true);
      }
      const visible = result.findings.filter((finding) =>
        meetsConfidence(finding.confidence, confidence),
      );
      const visibleSet = new Set(visible);
      const candidates = result.fixes.filter((fix) => visibleSet.has(fix.finding));
      if (candidates.length === 0) {
        return textResult('No safe fixes available for the selected findings.');
      }
      const applied = await applyFixes(candidates, { write: false });
      const files = applied.fixedFiles.map((file) => path.relative(deps.root, file)).sort();
      return textResult(
        [
          `would fix ${applied.fixedFindings} finding(s) in ${files.length} file(s)`,
          ...files.map((file) => `  ${file}`),
          ...applied.warnings.map((warning) => `warning: ${warning}`),
        ].join('\n'),
      );
    }

    return textResult(`Unknown tool: ${name}`, true);
  }

  return {
    async handle(line: string): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        return fail(null, -32700, 'Parse error');
      }
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) return fail(null, -32600, 'Invalid request');
        const responses: JsonRpcResponse[] = [];
        for (const item of parsed) {
          const response = await this.handle(JSON.stringify(item));
          if (Array.isArray(response)) responses.push(...response);
          else if (response) responses.push(response);
        }
        return responses.length > 0 ? responses : null;
      }
      const request = parsed as JsonRpcRequest;
      if (
        request === null ||
        typeof request !== 'object' ||
        typeof request.method !== 'string' ||
        request.jsonrpc !== '2.0' ||
        (request.id !== undefined &&
          request.id !== null &&
          typeof request.id !== 'string' &&
          typeof request.id !== 'number') ||
        (request.params !== undefined &&
          (request.params === null ||
            typeof request.params !== 'object' ||
            Array.isArray(request.params)))
      ) {
        return fail(null, -32600, 'Invalid request');
      }

      const isNotification = request.id === undefined;
      const id = request.id ?? null;
      const reply = (response: JsonRpcResponse): JsonRpcResponse | null =>
        isNotification ? null : response;

      try {
        switch (request.method) {
          case 'initialize': {
            const requested = (request.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
            return reply(ok(id, {
              protocolVersion: typeof requested === 'string' && PROTOCOL_VERSIONS.has(requested)
                ? requested
                : PROTOCOL_FALLBACK,
              capabilities: { tools: {} },
              serverInfo: { name: 'slopgate', version: deps.version },
            }));
          }
          case 'notifications/initialized':
            return isNotification ? null : reply(ok(id, {}));
          case 'ping':
            return reply(ok(id, {}));
          case 'tools/list':
            return reply(ok(id, { tools: TOOLS }));
          case 'tools/call': {
            const params = (request.params ?? {}) as { name?: unknown; arguments?: unknown };
            if (typeof params.name !== 'string') {
              return isNotification ? null : fail(id, -32602, 'tools/call requires a tool name');
            }
            if (!TOOLS.some((tool) => tool.name === params.name)) {
              return isNotification ? null : fail(id, -32602, `Unknown tool: ${params.name}`);
            }
            if (
              params.arguments !== undefined &&
              (params.arguments === null ||
                typeof params.arguments !== 'object' ||
                Array.isArray(params.arguments))
            ) {
              return isNotification ? null : fail(id, -32602, 'tools/call arguments must be an object');
            }
            const args =
              params.arguments !== null && typeof params.arguments === 'object'
                ? (params.arguments as Record<string, unknown>)
                : {};
            const result = await callTool(params.name, args);
            return reply(ok(id, result));
          }
          default:
            return isNotification ? null : fail(id, -32601, `Method not found: ${request.method}`);
        }
      } catch (error) {
        const message = (error as Error).message;
        if (request.method === 'tools/call') {
          return reply(ok(id, textResult(`slopgate error: ${message}`, true)));
        }
        return isNotification ? null : fail(id, -32603, message);
      }
    },
  };
}

export function defaultMcpDeps(root: string, version: string): Omit<McpDeps, 'config'> {
  interface ConfigInfo {
    config: Config;
    file: string | undefined;
    root: string;
  }
  const configCache = new Map<string, { stamp: string; pending: Promise<ConfigInfo> }>();
  const configRootFor = async (start: string): Promise<string> => {
    const target = path.resolve(start);
    const repoRoot = (await findGitRoot(target)) ?? root;
    return findConfigRoot(target, repoRoot);
  };
  const configStamp = async (configRoot: string): Promise<string> => {
    const parts: string[] = [];
    for (const name of CONFIG_FILENAMES) {
      try {
        const info = await stat(path.join(configRoot, name));
        parts.push(`${name}:${info.mtimeMs}:${info.size}`);
      } catch {
        parts.push(`${name}:none`);
      }
    }
    return parts.join('|');
  };
  const configInfoFor = async (start: string): Promise<ConfigInfo> => {
    const configRoot = await configRootFor(start);
    const stamp = await configStamp(configRoot);
    const cached = configCache.get(configRoot);
    if (cached?.pending && cached.stamp === stamp) return cached.pending;
    const pending = loadConfig(configRoot).then((loaded) => ({
      config: loaded.config,
      file: loaded.file,
      root: configRoot,
    }));
    configCache.set(configRoot, { stamp, pending });
    return pending;
  };
  const configFor = async (start: string): Promise<Config> => {
    return (await configInfoFor(start)).config;
  };

  return {
    root,
    version,
    configFor,
    async scan(scanRoot: string, minConfidence?: Confidence) {
      const configInfo = await configInfoFor(scanRoot);
      const config = minConfidence
        ? { ...configInfo.config, confidence: minConfidence, failOn: minConfidence }
        : configInfo.config;

      const target = path.resolve(scanRoot);
      const info = await stat(target).catch(() => undefined);
      const base = info?.isFile() ? path.dirname(target) : target;
      const repoRoot = (await findGitRoot(base)) ?? root;
      const projectRoot = await resolveProjectRoot(base, repoRoot);
      const globRoot = configInfo.file ? configInfo.root : projectRoot;
      // No registry cache: a new module or manifest must be visible on the
      // next scan. Project deps are lazy, so the traversal is the only cost.
      const indexRoot = repoRoot;
      const result = await scanProject({
        root: target,
        projectRoot,
        configRoot: globRoot,
        indexRoot,
        lookupRoot: repoRoot,
        reportRoot: root,
        config,
      });

      // Respect a baseline if one exists, so agents do not re-report known debt.
      // A subdirectory MCP root still uses the repository-root baseline.
      const baselineRoot = (await findGitRoot(root)) ?? root;
      const baseline = await loadBaseline(path.join(baselineRoot, '.slopgate-baseline.json'));
      if (baseline) {
        const prefix = path.relative(baselineRoot, root).replace(/\\/g, '/').replace(/\/+$/, '');
        const normalized = result.findings.map((finding) =>
          prefix ? { ...finding, file: `${prefix}/${finding.file}` } : finding,
        );
        const originals = new Map(normalized.map((finding, index) => [finding, result.findings[index]!]));
        const fresh = partitionByBaseline(normalized, baseline).fresh.map(
          (finding) => originals.get(finding) ?? finding,
        );
        return { ...result, findings: fresh };
      }
      return result;
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
