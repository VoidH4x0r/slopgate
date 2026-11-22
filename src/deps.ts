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

/** Split an array body on commas outside quotes and inline tables. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let quote: string | undefined;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) {
      if (ch === quote && value[i - 1] !== '\\') quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

/** True when the (possibly multi-line) array body contains its closing `]`. */
function closesArray(value: string): boolean {
  let quote: string | undefined;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) {
      if (ch === quote && value[i - 1] !== '\\') quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ']') {
      return true;
    }
  }
  return false;
}

interface ArrayEntries {
  requirements: string[];
  includes: string[];
}

/**
 * PEP 621 / PEP 735 arrays contain requirement strings and
 * `{ include-group = "name" }` tables. Taking the first quoted token of each
 * entry avoids treating environment markers as package names.
 */
function arrayEntries(body: string): ArrayEntries {
  const requirements: string[] = [];
  const includes: string[] = [];
  for (const entry of splitTopLevel(body)) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    const include = /include-group\s*=\s*["']([^"']+)["']/.exec(trimmed);
    if (include?.[1]) {
      includes.push(include[1]);
      continue;
    }
    const first = /^"([^"\\]*(?:\\.[^"\\]*)*)"|^'([^'\\]*(?:\\.[^'\\]*)*)'/.exec(trimmed);
    const value = first?.[1] ?? first?.[2];
    if (!value) continue;
    const name = requirementName(value);
    if (name) requirements.push(name);
  }
  return { requirements, includes };
}

const POETRY_GROUP = /^tool\.poetry\.group\.([^.]+)\.dependencies$/;

/** Key of a simple `key = value` / `key = [` line, including quoted keys. */
function tomlKey(line: string): string | undefined {
  const match = /^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\s*=/.exec(line);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function isPyprojectArraySection(section: string, key: string): boolean {
  if (section === 'project') return key === 'dependencies';
  if (section === 'project.optional-dependencies') return true;
  if (section === 'dependency-groups') return true;
  if (section === 'tool.uv') return key === 'dev-dependencies';
  if (section === 'build-system') return key === 'requires';
  return false;
}

/** Best-effort parse of the Python dependency declarations we can see. */
export function parsePythonManifestText(fileName: string, text: string): string[] {
  const names: string[] = [];
  const base = path.basename(fileName).toLowerCase();

  if (base.startsWith('requirements') && (base.endsWith('.txt') || base.endsWith('.in'))) {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+#.*$/, '');
      const name = requirementName(line);
      if (name) names.push(name);
    }
    return names;
  }

  if (base === 'environment.yml' || base === 'environment.yaml') {
    let inDependencies = false;
    for (const rawLine of text.split(/\r?\n/)) {
      if (/^\s*dependencies\s*:/.test(rawLine)) {
        inDependencies = true;
        continue;
      }
      if (inDependencies && /^\S/.test(rawLine)) inDependencies = false;
      if (!inDependencies) continue;
      const item = /^\s*-\s+([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(rawLine);
      if (!item?.[1] || item[1] === 'pip' || item[1] === 'python') continue;
      names.push(normalizePythonName(item[1]));
    }
    return names;
  }

  if (base === 'pyproject.toml') {
    const collected: string[] = [];
    const groups = new Map<string, ArrayEntries>();
    let section = '';
    let pending: { section: string; key: string; buffer: string } | undefined;

    const collect = (targetSection: string, key: string, body: string): void => {
      const entries = arrayEntries(body);
      if (targetSection === 'dependency-groups') {
        const group = groups.get(key) ?? { requirements: [], includes: [] };
        group.requirements.push(...entries.requirements);
        group.includes.push(...entries.includes);
        groups.set(key, group);
      } else {
        collected.push(...entries.requirements);
      }
    };

    for (const rawLine of text.split(/\r?\n/)) {
      const line = stripTomlComments(rawLine);
      if (pending) {
        pending.buffer += '\n' + line;
        if (closesArray(line)) {
          collect(pending.section, pending.key, pending.buffer);
          pending = undefined;
        }
        continue;
      }
      const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
      if (sectionMatch?.[1]) {
        section = sectionMatch[1].trim();
        continue;
      }
      const arrayStart = /^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\s*=\s*\[(.*)$/.exec(line);
      if (arrayStart) {
        const key = arrayStart[1] ?? arrayStart[2] ?? arrayStart[3] ?? '';
        const rest = arrayStart[4] ?? '';
        if (isPyprojectArraySection(section, key)) {
          if (closesArray(rest)) collect(section, key, rest);
          else pending = { section, key, buffer: rest };
        }
        continue;
      }
      if (
        section === 'tool.poetry.dependencies' ||
        section === 'tool.poetry.dev-dependencies' ||
        POETRY_GROUP.test(section)
      ) {
        const key = tomlKey(line);
        if (key && key.toLowerCase() !== 'python') collected.push(normalizePythonName(key));
      }
    }

    // Resolve PEP 735 include-group references (with cycle protection).
    const resolved = new Set<string>();
    const resolveGroup = (name: string, seen: Set<string>): void => {
      if (seen.has(name)) return;
      seen.add(name);
      const group = groups.get(name);
      if (!group) return;
      for (const requirement of group.requirements) resolved.add(requirement);
      for (const include of group.includes) resolveGroup(include, seen);
    };
    for (const name of groups.keys()) resolveGroup(name, new Set());
    collected.push(...resolved);

    return [...new Set(collected)];
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

const PROJECT_MARKERS = [
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'Pipfile',
  'requirements.txt',
  'requirements.in',
  'requirements/all.txt',
  'requirements/base.txt',
  'requirements/dev.txt',
  'requirements/prod.txt',
  'package.json',
];

async function hasProjectMarker(dir: string): Promise<boolean> {
  for (const marker of PROJECT_MARKERS) {
    if (await exists(path.join(dir, marker))) return true;
  }
  return false;
}

/**
 * Nearest directory that owns a Python or Node project. A file target starts
 * at its containing directory; a nested `src/` starts there and walks upwards
 * to the package manifest, stopping at the git root.
 */
export async function resolveProjectRoot(
  start: string,
  repoRoot?: string,
): Promise<string> {
  let dir = path.resolve(start);
  try {
    if ((await stat(dir)).isFile()) dir = path.dirname(dir);
  } catch {
    // Let the caller's normal path validation report a missing target.
  }

  const stop = repoRoot ? path.resolve(repoRoot) : dir;
  if (repoRoot) {
    const relative = path.relative(stop, dir);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return dir;
  }

  for (;;) {
    if (await hasProjectMarker(dir)) return dir;
    if (dir === stop) return stop;
    const parent = path.dirname(dir);
    if (parent === dir) return stop;
    dir = parent;
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
  'requirements.in', 'requirements-dev.txt', 'requirements_dev.txt', 'dev-requirements.txt',
  'requirements/base.txt', 'requirements/dev.txt', 'requirements/prod.txt',
  'requirements/main.txt', 'requirements/test.txt', 'requirements/tests.txt',
  'environment.yml', 'environment.yaml',
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
    // With only `baseUrl`, TypeScript resolves bare imports under that
    // directory (`components/button` -> `src/components/button`). The first
    // path segment is the alias prefix this checker can match.
    const baseUrl = parsed.compilerOptions?.baseUrl;
    if (typeof baseUrl === 'string') {
      const base = path.resolve(root, baseUrl);
      const entries = await readDirSafe(base);
      for (const entry of entries ?? []) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) aliases.push(entry.name);
        else if (entry.isFile()) {
          const stem = entry.name.replace(/\.(?:[cm]?[jt]sx?)$/, '');
          if (stem !== entry.name) aliases.push(stem);
        }
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
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const scoped = await readDirSafe(path.join(modulesDir, entry.name));
      if (!scoped) continue;
      for (const child of scoped) {
        if (child.isDirectory() || child.isSymbolicLink()) installed.add(`${entry.name}/${child.name}`);
      }
      continue;
    }
    // pnpm and npm link expose packages as symlinks; they are still installed.
    if (entry.isDirectory() || entry.isSymbolicLink()) installed.add(entry.name);
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
