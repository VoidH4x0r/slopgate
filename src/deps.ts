import { readFile, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import type { NodeDeps, ProjectDeps, PythonDeps } from './types.ts';

/** PEP 503 normalization: lowercase, runs of `[-_.]` collapse to `-`. */
export function normalizePythonName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

/** `requests[socks]>=2.0 ; python_version > "3.6"` -> `requests` */
export function requirementName(spec: string): string | undefined {
  const trimmed = spec.trim().replace(/^['"]|['"]$/g, '').trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) return undefined;
  if (trimmed.includes('://')) return undefined;
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(trimmed);
  return match?.[1] ? normalizePythonName(match[1]) : undefined;
}

function stripTomlComments(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote && line[i - 1] !== '\\') quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

function quotedStrings(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const value = match[1] ?? match[2];
    if (value) out.push(value);
  }
  return out;
}

/** Best-effort parse of the Python dependency declarations we can see. */
export function parsePythonManifestText(fileName: string, text: string): string[] {
  const names: string[] = [];
  const base = path.basename(fileName).toLowerCase();

  if (base.startsWith('requirements') && base.endsWith('.txt')) {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+#.*$/, '');
      const name = requirementName(line);
      if (name) names.push(name);
    }
    return names;
  }

  if (base === 'pyproject.toml') {
    const lines = text.split(/\r?\n/);
    let section = '';
    let arrayRemaining = 0;
    for (const rawLine of lines) {
      const line = stripTomlComments(rawLine);
      const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
      if (sectionMatch?.[1]) {
        section = sectionMatch[1].trim();
        continue;
      }
      if (arrayRemaining > 0) {
        for (const value of quotedStrings(line)) {
          const name = requirementName(value);
          if (name) names.push(name);
        }
        if (line.includes(']')) arrayRemaining = 0;
        continue;
      }
      const arrayStart = /^\s*(dependencies|requires)\s*=\s*\[(.*)$/.exec(line);
      if (arrayStart) {
        const inline = arrayStart[2] ?? '';
        for (const value of quotedStrings(inline)) {
          const name = requirementName(value);
          if (name) names.push(name);
        }
        if (!inline.includes(']')) arrayRemaining = 1;
        continue;
      }
      if (section === 'tool.poetry.dependencies' || section === 'tool.poetry.dev-dependencies' || section === 'tool.poetry.group.dev.dependencies') {
        const kv = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(line);
        if (kv?.[1] && kv[1].toLowerCase() !== 'python') {
          names.push(normalizePythonName(kv[1]));
        }
      }
      if (section === 'build-system') {
        const requires = /^\s*requires\s*=\s*\[(.*)/.exec(line);
        if (requires?.[1] !== undefined) {
          for (const value of quotedStrings(requires[1])) {
            const name = requirementName(value);
            if (name) names.push(name);
          }
        }
      }
    }
    return names;
  }

  if (base === 'setup.py') {
    const blocks = [...text.matchAll(/install_requires\s*=\s*\[([\s\S]*?)\]/g)];
    for (const block of blocks) {
      for (const value of quotedStrings(block[1] ?? '')) {
        const name = requirementName(value);
        if (name) names.push(name);
      }
    }
    const extras = [...text.matchAll(/extras_require\s*=\s*\{([\s\S]*?)\}\s*[,)]/g)];
    for (const block of extras) {
      for (const value of quotedStrings(block[1] ?? '')) {
        const name = requirementName(value);
        if (name) names.push(name);
      }
    }
    return names;
  }

  if (base === 'setup.cfg') {
    const sectionMatch = /\[options\]([\s\S]*?)(?=\n\[|$)/.exec(text);
    if (sectionMatch?.[1]) {
      const requires = /install_requires\s*=\s*([\s\S]*?)(?=\n\S|$)/.exec(sectionMatch[1]);
      if (requires?.[1]) {
        for (const rawLine of requires[1].split(/\r?\n/)) {
          const name = requirementName(rawLine);
          if (name) names.push(name);
        }
      }
    }
    return names;
  }

  if (base === 'pipfile') {
    const sectionMatch = /\[packages\]([\s\S]*?)(?=\n\[|$)/.exec(text);
    if (sectionMatch?.[1]) {
      for (const rawLine of sectionMatch[1].split(/\r?\n/)) {
        const kv = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(rawLine);
        if (kv?.[1]) names.push(normalizePythonName(kv[1]));
      }
    }
    return names;
  }

  return names;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(p: string): Promise<string | undefined> {
  try {
    const text = await readFile(p, 'utf8');
    return text.replace(/^\uFEFF/, '');
  } catch {
    return undefined;
  }
}

/** Parse JSON without turning a broken manifest into a crash. */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function readDirSafe(dir: string): Promise<Dirent[] | undefined> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
}

const PYTHON_MANIFESTS = [
  'pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile', 'requirements.txt',
  'requirements-dev.txt', 'requirements_dev.txt', 'dev-requirements.txt',
  'requirements/base.txt', 'requirements/dev.txt', 'requirements/prod.txt',
  'requirements/main.txt', 'requirements/test.txt', 'requirements/tests.txt',
];

async function loadPythonDeps(root: string): Promise<PythonDeps> {
  const declared = new Set<string>();
  const manifests: string[] = [];
  for (const rel of PYTHON_MANIFESTS) {
    const abs = path.join(root, rel);
    const text = await readIfExists(abs);
    if (text === undefined) continue;
    manifests.push(rel.replace(/\\/g, '/'));
    for (const name of parsePythonManifestText(rel, text)) declared.add(name);
  }
  return { declared, manifests, localModules: new Set<string>() };
}

function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

async function loadTsconfigAliases(root: string): Promise<string[]> {
  const aliases: string[] = [];
  for (const name of ['tsconfig.json', 'tsconfig.base.json']) {
    const text = await readIfExists(path.join(root, name));
    if (!text) continue;
    const parsed = tryParseJson(stripJsonComments(text)) as
      | { compilerOptions?: { paths?: Record<string, unknown>; baseUrl?: string } }
      | undefined;
    if (!parsed) continue;
    const paths = parsed.compilerOptions?.paths;
    if (paths && typeof paths === 'object') {
      for (const key of Object.keys(paths)) {
        const cleaned = key.replace(/\/\*$/, '').replace(/\*$/, '');
        if (cleaned) aliases.push(cleaned);
      }
    }
  }
  return aliases;
}

async function loadInstalledPackages(root: string): Promise<Set<string>> {
  const installed = new Set<string>();
  const modulesDir = path.join(root, 'node_modules');
  const entries = await readDirSafe(modulesDir);
  if (!entries) return installed;
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      if (!entry.isDirectory()) continue;
      const scoped = await readDirSafe(path.join(modulesDir, entry.name));
      if (!scoped) continue;
      for (const child of scoped) {
        if (child.isDirectory()) installed.add(`${entry.name}/${child.name}`);
      }
      continue;
    }
    if (entry.isDirectory()) installed.add(entry.name);
  }
  return installed;
}

async function loadWorkspaceNames(root: string): Promise<{ names: Set<string>; dependencies: Set<string> }> {
  const names = new Set<string>();
  const dependencies = new Set<string>();
  const visited = new Set<string>();

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > 3 || visited.has(dir)) return;
    visited.add(dir);
    const pkgPath = path.join(dir, 'package.json');
    const text = await readIfExists(pkgPath);
    const parsed = text ? (tryParseJson(text) as Record<string, unknown> | undefined) : undefined;
    if (parsed) {
      if (typeof parsed.name === 'string' && parsed.name.length > 0) names.add(parsed.name);
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const deps = parsed[field];
        if (deps && typeof deps === 'object') {
          for (const name of Object.keys(deps as Record<string, unknown>)) dependencies.add(name);
        }
      }
    }
    const entries = await readDirSafe(dir);
    if (!entries) return;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      await scan(path.join(dir, entry.name), depth + 1);
    }
  }

  await scan(root, 0);
  return { names, dependencies };
}

async function loadNodeDeps(root: string): Promise<NodeDeps> {
  const declared = new Set<string>();
  const pkgPath = path.join(root, 'package.json');
  const hasPackageJson = await exists(pkgPath);
  const text = await readIfExists(pkgPath);
  const pkg = text ? (tryParseJson(text) as Record<string, unknown> | undefined) : undefined;

  if (pkg) {
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = pkg[field];
      if (deps && typeof deps === 'object') {
        for (const name of Object.keys(deps as Record<string, unknown>)) declared.add(name);
      }
    }
  }

  const [aliases, installed, workspaceInfo] = await Promise.all([
    loadTsconfigAliases(root),
    loadInstalledPackages(root),
    loadWorkspaceNames(root),
  ]);

  for (const dependency of workspaceInfo.dependencies) declared.add(dependency);

  return {
    declared,
    workspaces: workspaceInfo.names,
    aliases,
    hasPackageJson,
    installed,
  };
}

export async function loadProjectDeps(root: string): Promise<ProjectDeps> {
  const absRoot = path.resolve(root);
  const [python, node] = await Promise.all([loadPythonDeps(absRoot), loadNodeDeps(absRoot)]);
  return { root: absRoot, python, node, ignoredModules: new Set<string>() };
}
