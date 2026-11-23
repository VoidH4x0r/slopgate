import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  createMcpServer,
  defaultMcpDeps,
  isInsideRoot,
  type McpDeps,
} from '../src/mcp.ts';
import { writeBaseline } from '../src/baseline.ts';
import { DEFAULT_CONFIG, type Config } from '../src/config.ts';
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
    files: [],
    fixes: [],
    suppressedCount: 0,
    warnings: [],
    stats: {
      files,
      byLanguage:
        files === 0
          ? { python: 0, javascript: 0, typescript: 0, tsx: 0, go: 0 }
          : { python: 3, javascript: 0, typescript: 0, tsx: 0, go: 0 },
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

test('mcp: a monorepo root scan uses each backend manifest', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-mcp-monorepo-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'backend'), { recursive: true });
    await writeFile(
      path.join(dir, 'backend', 'pyproject.toml'),
      '[project]\nname = "backend"\nversion = "0.0.0"\ndependencies = ["django"]\n',
    );
    await writeFile(path.join(dir, 'backend', 'app.py'), 'import django\n');

    const deps = defaultMcpDeps(dir, '0.1.0');
    const server = createMcpServer({ ...deps, config: DEFAULT_CONFIG });
    for (const target of ['.', 'backend']) {
      const response = await call(server, {
        jsonrpc: '2.0',
        id: 17,
        method: 'tools/call',
        params: { name: 'scan_path', arguments: { path: target } },
      });
      const text =
        (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      assert.doesNotMatch(text, /phantom-import/, target);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mcp: registry and config caches observe filesystem changes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-mcp-cache-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await writeFile(path.join(dir, 'app.py'), 'import newlib\n');
    const deps = defaultMcpDeps(dir, '0.1.0');
    const server = createMcpServer({ ...deps, config: DEFAULT_CONFIG });

    const first = await call(server, {
      jsonrpc: '2.0',
      id: 18,
      method: 'tools/call',
      params: { name: 'scan_path', arguments: { path: '.' } },
    });
    assert.match(
      (first.result as { content: Array<{ text: string }> }).content[0]?.text ?? '',
      /py\/phantom-import/,
    );

    await mkdir(path.join(dir, 'newlib'));
    await writeFile(path.join(dir, 'newlib', '__init__.py'), '');
    const second = await call(server, {
      jsonrpc: '2.0',
      id: 19,
      method: 'tools/call',
      params: { name: 'scan_path', arguments: { path: '.' } },
    });
    assert.doesNotMatch(
      (second.result as { content: Array<{ text: string }> }).content[0]?.text ?? '',
      /py\/phantom-import/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mcp: config changes invalidate the cached config', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-mcp-config-cache-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await writeFile(path.join(dir, 'app.py'), 'def stubbed():\n    pass\n');
    await writeFile(path.join(dir, '.slopgate.json'), '{"rules":{"py/stub-body":"off"}}\n');
    const deps = defaultMcpDeps(dir, '0.1.0');
    const server = createMcpServer({ ...deps, config: DEFAULT_CONFIG });

    const off = await call(server, {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: { name: 'scan_path', arguments: { path: '.' } },
    });
    assert.doesNotMatch(
      (off.result as { content: Array<{ text: string }> }).content[0]?.text ?? '',
      /py\/stub-body/,
    );

    await writeFile(path.join(dir, '.slopgate.json'), '{}\n');
    const on = await call(server, {
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: { name: 'scan_path', arguments: { path: '.' } },
    });
    assert.match(
      (on.result as { content: Array<{ text: string }> }).content[0]?.text ?? '',
      /py\/stub-body/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mcp: scan_path uses the nearest package config, like the CLI', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-mcp-config-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'packages', 'app'), { recursive: true });
    await writeFile(
      path.join(dir, '.slopgate.json'),
      '{"rules":{"py/stub-body":"error"}}',
    );
    await writeFile(
      path.join(dir, 'packages', 'app', '.slopgate.json'),
      '{"rules":{"py/stub-body":"off"}}',
    );
    await writeFile(path.join(dir, 'packages', 'app', 'app.py'), 'def stubbed():\n    pass\n');

    const deps = defaultMcpDeps(dir, '0.1.0');
    const server = createMcpServer({ ...deps, config: DEFAULT_CONFIG });
    const packageResponse = await call(server, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'scan_path', arguments: { path: 'packages/app' } },
    });
    const packageText =
      (packageResponse.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    assert.match(packageText, /0 finding\(s\)/);
    assert.doesNotMatch(packageText, /py\/stub-body/);

    const rootResponse = await call(server, {
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'scan_path', arguments: { path: '.' } },
    });
    const rootText =
      (rootResponse.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    assert.match(rootText, /py\/stub-body/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mcp: a single-file scan_path resolves the repository project root', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-mcp-file-root-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(
      path.join(dir, 'pyproject.toml'),
      '[project]\nname = "root"\nversion = "0.0.0"\ndependencies = ["requests"]\n',
    );
    await writeFile(path.join(dir, 'src', 'util.py'), 'def helper():\n    return 1\n');
    await writeFile(
      path.join(dir, 'src', 'app.py'),
      'import requests\nfrom util import helper\n\ndef stubbed():\n    pass\n',
    );

    const deps = defaultMcpDeps(dir, '0.1.0');
    const server = createMcpServer({ ...deps, config: DEFAULT_CONFIG });
    const response = await call(server, {
      jsonrpc: '2.0',
      id: 16,
      method: 'tools/call',
      params: { name: 'scan_path', arguments: { path: 'src/app.py' } },
    });
    const text =
      (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    assert.match(text, /src\/app\.py:4:1/);
    assert.doesNotMatch(text, /not declared/);
    assert.match(text, /py\/stub-body/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mcp: scan_path reports paths relative to the MCP root', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-mcp-paths-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'packages', 'app'), { recursive: true });
    await writeFile(path.join(dir, 'packages', 'app', 'app.py'), 'def stubbed():\n    pass\n');

    const deps = defaultMcpDeps(dir, '0.1.0');
    const server = createMcpServer({ ...deps, config: DEFAULT_CONFIG });
    const response = await call(server, {
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'scan_path', arguments: { path: 'packages/app' } },
    });
    const text =
      (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    assert.match(text, /packages\/app\/app\.py:1:1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mcp: the target config confidence is the default for scan_path', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-mcp-confidence-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'packages', 'app'), { recursive: true });
    await writeFile(
      path.join(dir, 'packages', 'app', '.slopgate.json'),
      '{"confidence":"medium"}',
    );
    await writeFile(
      path.join(dir, 'packages', 'app', 'app.py'),
      [
        'def f():',
        '    try:',
        '        run()',
        '    # best effort; ignore the error',
        '    except Exception:',
        '        pass',
      ].join('\n'),
    );

    const deps = defaultMcpDeps(dir, '0.1.0');
    const server = createMcpServer({ ...deps, config: DEFAULT_CONFIG });
    const response = await call(server, {
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: { name: 'scan_path', arguments: { path: 'packages/app' } },
    });
    const text =
      (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    assert.match(text, /py\/swallowed-exception/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mcp: a root baseline suppresses subdirectory and file scans', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-mcp-baseline-'));
  try {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'packages', 'lib'), { recursive: true });
    await writeFile(path.join(dir, 'packages', 'lib', 'app.py'), 'def stubbed():\n    pass\n');

    const deps = defaultMcpDeps(dir, '0.1.0');
    const initial = await deps.scan(path.join(dir, 'packages', 'lib'));
    const entry = initial.findings[0];
    assert.ok(entry);
    assert.equal(entry.file, 'packages/lib/app.py');
    await writeBaseline(path.join(dir, '.slopgate-baseline.json'), [entry]);

    const server = createMcpServer({ ...deps, config: DEFAULT_CONFIG });
    for (const target of ['packages/lib', 'packages/lib/app.py', '.']) {
      const response = await call(server, {
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: { name: 'scan_path', arguments: { path: target } },
      });
      const text =
        (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      assert.match(text, /0 finding\(s\)/, target);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
