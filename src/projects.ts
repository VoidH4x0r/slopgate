import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { isProjectDir, loadProjectDeps } from './deps.ts';
import { DEFAULT_IGNORE_DIRS, globToRegExp, matchesAny, toPosix } from './files.ts';
import type { LanguageId, ProjectDeps } from './types.ts';

const MAX_WALK_DEPTH = 12;
const PYTHON_FILE = /\.pyi?$/;
const VALID_MODULE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ProjectRegistryOptions {
  /** Directory to index for projects and local modules. */
  scopeRoot: string;
  /** Project used when no manifest owns the file. */
  fallbackRoot: string;
  /** Base for config include/exclude patterns. */
  configRoot?: string;
  exclude?: readonly string[];
  ignoreModules?: readonly string[];
}

export interface ProjectRegistry {
  scopeRoot: string;
  projectDirs: ReadonlySet<string>;
  /** Deps for the nearest project that owns the requested language. */
  depsFor(fileAbs: string, language: LanguageId): Promise<ProjectDeps>;
  /** One warning per project where TS phantom checks cannot run. */
  missingPackageJson(fileAbs: string, language: LanguageId): Promise<string | undefined>;
}

function addPythonModule(localModules: Set<string>, relative: string): void {
  const parts = toPosix(relative).split('/');
  const fileName = parts.pop() ?? '';
  for (const dir of parts) {
    if (VALID_MODULE.test(dir)) localModules.add(dir);
  }
  const stem = fileName.replace(PYTHON_FILE, '');
  if (VALID_MODULE.test(stem)) localModules.add(stem);
}

/**
 * Indexes project directories and Python module names under one root. Project
 * dependencies are loaded lazily, only for files that actually reach them.
 */
export async function loadProjectRegistry(
  options: ProjectRegistryOptions,
): Promise<ProjectRegistry> {
  const scope = path.resolve(options.scopeRoot);
  const fallbackDir = path.resolve(options.fallbackRoot);
  const excludeRoot = path.resolve(options.configRoot ?? scope);
  const excludeRe = (options.exclude ?? []).map(globToRegExp);
  const ignoredModules = new Set(options.ignoreModules ?? []);
  const localModules = new Set<string>();
  const projectDirs = new Set<string>();
  const depsCache = new Map<string, Promise<ProjectDeps>>();
  const warnedProjects = new Set<string>();

  const relativeToExcludeRoot = (abs: string): string => {
    const relative = toPosix(path.relative(excludeRoot, abs));
    return relative.startsWith('..') || path.isAbsolute(relative) ? '' : relative;
  };
  const isExcluded = (abs: string, directory: boolean): boolean => {
    const relative = relativeToExcludeRoot(abs);
    if (!relative) return false;
    return matchesAny(relative, excludeRe) || (directory && matchesAny(`${relative}/`, excludeRe));
  };

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_WALK_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (await isProjectDir(dir)) projectDirs.add(dir);

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(entry.name) || isExcluded(abs, true)) continue;
        await walk(abs, depth + 1);
        continue;
      }
      if (entry.isFile() && PYTHON_FILE.test(entry.name) && !isExcluded(abs, false)) {
        addPythonModule(localModules, path.relative(scope, abs));
      }
    }
  }

  await walk(scope, 0);
  if (projectDirs.size === 0 && (await isProjectDir(fallbackDir))) {
    projectDirs.add(fallbackDir);
  }

  const loadProject = (dir: string): Promise<ProjectDeps> => {
    let pending = depsCache.get(dir);
    if (!pending) {
      pending = loadProjectDeps(dir).then((deps) => {
        deps.python.localModules = localModules;
        deps.ignoredModules = ignoredModules;
        return deps;
      });
      depsCache.set(dir, pending);
    }
    return pending;
  };

  const matchesLanguage = (deps: ProjectDeps, language: LanguageId): boolean =>
    language === 'python'
      ? deps.python.manifests.length > 0
      : deps.node.hasPackageJson;

  const fallback = (): Promise<ProjectDeps> => loadProject(fallbackDir);

  const registry: ProjectRegistry = {
    scopeRoot: scope,
    projectDirs,
    async depsFor(fileAbs: string, language: LanguageId): Promise<ProjectDeps> {
      let dir = path.dirname(path.resolve(fileAbs));
      for (;;) {
        if (projectDirs.has(dir)) {
          const deps = await loadProject(dir);
          if (matchesLanguage(deps, language)) return deps;
        }
        if (dir === scope) break;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return fallback();
    },
    async missingPackageJson(fileAbs: string, language: LanguageId): Promise<string | undefined> {
      if (language === 'python') return undefined;
      const deps = await registry.depsFor(fileAbs, language);
      if (deps.node.hasPackageJson) return undefined;
      const project = deps.root;
      if (warnedProjects.has(project)) return undefined;
      warnedProjects.add(project);
      return `no package.json found for ${project}; TypeScript phantom imports are not checked for this project`;
    },
  };
  return registry;
}
