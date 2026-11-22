import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';
import { createMcpServer, isInsideRoot, type McpDeps } from '../src/mcp.ts';
import type { Config } from '../src/config.ts';
import type { ScanResult } from '../src/engine.ts';
import type { Finding } from '../src/types.ts';
import type { DiffSet } from '../src/diff.ts';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'py/phantom-import',
    message: '`requests_v2` is imported but not declared',
    severity: 'error',
    confidence: 'high',
    file: 'app.py',
    start: { line: 4, column: 1 },
    end: { line: 4, column: 18 },
    snippet: 'import requests_v2',
    evidence: ['no Python dependency manifest found'],
    ...overrides,
  };
}

const config: Config = {
  include: ['**/*.py'],
  exclude: [],
  ignoreModules: [],
  rules: {},
  confidence: 'high',
  failOn: 'high',
};

function scanResult(findings: Finding[], files = 3): ScanResult {
  return {
    findings,
    suppressedCount: 0,
    warnings: [],
    stats: {
      files,
      byLanguage:
        files === 0
          ? { python: 0, javascript: 0, typescript: 0, tsx: 0 }
          : { python: 3, javascript: 0, typescript: 0, tsx: 0 },
      skipped: files === 0 ? 1 : 0,
      parseErrors: 0,
      durationMs: 12,
    },
  };
}

function makeServer(overrides: Partial<McpDeps> = {}) {
  const deps: McpDeps = {
    root: process.cwd(),
    version: '0.1.0',
    config,
    scan: async () => scanResult([finding()]),
    diff: async () => ({ lines: new Map(), full: new Set() }) as DiffSet,
    ...overrides,
  };
  return createMcpServer(deps);
}

async function call(server: ReturnType<typeof makeServer>, request: unknown) {
  const response = await server.handle(JSON.stringify(request));
  assert.ok(response, 'expected a response');
  return response;
}

test('mcp: initialize echoes the requested protocol version', async () => {
  const server = makeServer();
  const response = await call(server, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' },
  });
  const result = response.result as {
    protocolVersion: string;
    capabilities: { tools: Record<string, never> };
    serverInfo: { name: string; version: string };
  };
  assert.equal(result.protocolVersion, '2025-06-18');
  assert.equal(result.serverInfo.name, 'slopgate');
  assert.equal(result.serverInfo.version, '0.1.0');
  assert.ok('tools' in result.capabilities);
});

test('mcp: initialized notification returns no response', async () => {
  const server = makeServer();
  assert.equal(await server.handle(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })), null);
});

test('mcp: tools/list exposes scan_diff, scan_path and list_rules', async () => {
  const server = makeServer();
  const response = await call(server, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const result = response.result as { tools: Array<{ name: string; inputSchema: unknown }> };
  const names = result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ['list_rules', 'scan_diff', 'scan_path']);
  for (const tool of result.tools) assert.equal(typeof tool.inputSchema, 'object');
});

test('mcp: scan_path returns a text summary and respects confidence', async () => {
  const server = makeServer({
    scan: async () =>
      scanResult([
        finding(),
        finding({
          ruleId: 'py/stub-body',
          message: 'stub',
          confidence: 'medium',
          start: { line: 9, column: 1 },
          end: { line: 9, column: 5 },
        }),
      ]),
  });
  const response = await call(server, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'scan_path', arguments: {} },
  });
  const content = (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
  assert.match(content, /1 finding\(s\)/);
  assert.match(content, /py\/phantom-import/);
  assert.doesNotMatch(content, /py\/stub-body/);
});

test('mcp: scan_path with medium confidence includes medium findings', async () => {
  const server = makeServer({
    scan: async () => scanResult([finding({ confidence: 'medium', ruleId: 'py/stub-body' })]),
  });
  const response = await call(server, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'scan_path', arguments: { confidence: 'medium' } },
  });
  const content = (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
  assert.match(content, /py\/stub-body/);
});

test('mcp: scan_path reports zero matched files as a tool error', async () => {
  const server = makeServer({ scan: async () => scanResult([], 0) });
  const response = await call(server, {
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'scan_path', arguments: {} },
  });
  const result = response.result as { isError?: boolean; content: Array<{ text: string }> };
  assert.equal(result.isError, true);
  assert.match(result.content[0]?.text ?? '', /No files matched/);
});

test('mcp: scan_diff reports zero matched files as a tool error', async () => {
  const server = makeServer({ scan: async () => scanResult([], 0) });
  const response = await call(server, {
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name: 'scan_diff', arguments: {} },
  });
  const result = response.result as { isError?: boolean; content: Array<{ text: string }> };
  assert.equal(result.isError, true);
  assert.match(result.content[0]?.text ?? '', /No files matched/);
});

test('mcp: scan_path refuses paths outside the repository root', async () => {
  const server = makeServer({ root: process.cwd() });
  const response = await call(server, {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'scan_path', arguments: { path: '../../etc' } },
  });
  const result = response.result as { isError?: boolean; content: Array<{ text: string }> };
  assert.equal(result.isError, true);
  assert.match(result.content[0]?.text ?? '', /outside the repository root/);
});

test('mcp: scan_diff only reports findings on changed lines', async () => {
  const diff: DiffSet = { lines: new Map([['app.py', new Set([4])]]), full: new Set() };
  const server = makeServer({
    diff: async () => diff,
    scan: async () =>
      scanResult([
        finding({ start: { line: 4, column: 1 }, end: { line: 4, column: 5 } }),
        finding({
          ruleId: 'py/unreachable',
          message: 'unreachable',
          start: { line: 40, column: 1 },
          end: { line: 40, column: 5 },
        }),
      ]),
  });
  const response = await call(server, {
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'scan_diff', arguments: { base: 'origin/main' } },
  });
  const content = (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
  assert.match(content, /Diff since origin\/main/);
  assert.match(content, /py\/phantom-import/);
  assert.doesNotMatch(content, /py\/unreachable/);
});

test('mcp: list_rules returns the rule table', async () => {
  const server = makeServer();
  const response = await call(server, {
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name: 'list_rules' },
  });
  const content = (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
  assert.match(content, /py\/phantom-import/);
  assert.match(content, /ts\/stub-function/);
});

test('mcp: unknown methods and malformed input produce JSON-RPC errors', async () => {
  const server = makeServer();
  const unknown = await call(server, { jsonrpc: '2.0', id: 8, method: 'resources/list' });
  assert.equal(unknown.error?.code, -32601);

  const parseError = await server.handle('{not json');
  assert.equal(parseError?.error?.code, -32700);

  const noName = await call(server, {
    jsonrpc: '2.0',
    id: 9,
    method: 'tools/call',
    params: { arguments: {} },
  });
  assert.equal(noName.error?.code, -32602);
});

test('mcp: isInsideRoot accepts the root and its children, rejects siblings', () => {
  const root = path.resolve('repo-root');
  assert.equal(isInsideRoot(root, root), true);
  assert.equal(isInsideRoot(root, path.join(root, 'src', 'app.py')), true);
  assert.equal(isInsideRoot(root, path.resolve('repo-root-sibling', 'x.py')), false);
  assert.equal(isInsideRoot(root, path.resolve('..', 'outside.py')), false);
});

test('mcp: a throwing scan becomes a tool error instead of crashing the server', async () => {
  const server = makeServer({
    scan: async () => {
      throw new Error('boom');
    },
  });
  const response = await call(server, {
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: { name: 'scan_path', arguments: {} },
  });
  const result = response.result as { isError?: boolean; content: Array<{ text: string }> };
  assert.equal(result.isError, true);
  assert.match(result.content[0]?.text ?? '', /boom/);
});
