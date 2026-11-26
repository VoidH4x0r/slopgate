import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { isProjectDir, isProjectDirFromEntries, loadProjectDeps } from './deps.ts';
import { DEFAULT_IGNORE_DIRS, globToRegExp, matchesAny, toPosix } from './files.ts';
import type { LanguageId, ProjectDeps } from './types.ts';

const MAX_WALK_DEPTH = 12;
const PYTHON_FILE = /\.pyi?$/;
const RUST_FILE = /\.rs$/;
const VALID_MODULE = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function hasPythonFiles(dir: string, depth = 0): Promise<boolean> {
  if (depth > 5) return false;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && PYTHON_FILE.test(entry.name)) return true;
      if (
        entry.isDirectory() &&
        VALID_MODULE.test(entry.name) &&
        !DEFAULT_IGNORE_DIRS.has(entry.name) &&
        (await hasPythonFiles(path.join(dir, entry.name), depth + 1))
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export interface ProjectRegistryOptions {
  /** Directory to index for projects and local modules. */
  scopeRoot: string;
  /** Outer boundary for lazy ancestor-project lookup (cwd for non-git). */
  lookupRoot?: string;
  /** Project used when no manifest owns the file. */
  fallbackRoot: string;
  /** Base for config include/exclude patterns. */
  configRoot?: string;
  exclude?: readonly string[];
  ignoreModules?: readonly string[];
}

export interface ProjectRegistry {
  scopeRoot: string;
  lookupRoot: string;
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

function addRustModule(localModules: Set<string>, relative: string): void {
  const parts = toPosix(relative).split('/');
  const fileName = parts.pop() ?? '';
  for (const dir of parts) {
    if (VALID_MODULE.test(dir)) localModules.add(dir);
  }
  const stem = fileName.replace(RUST_FILE, '');
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
  const lookup = path.resolve(options.lookupRoot ?? scope);
  const fallbackDir = path.resolve(options.fallbackRoot);
  const excludeRoot = path.resolve(options.configRoot ?? scope);
  const excludeRe = (options.exclude ?? []).map(globToRegExp);
  const ignoredModules = new Set(options.ignoreModules ?? []);
  const localModules = new Set<string>();
  const rustModules = new Set<string>();
  const projectDirs = new Set<string>();
  const projectCheckCache = new Map<string, boolean>();
  const depsCache = new Map<string, Promise<ProjectDeps>>();
  const warnedProjects = new Set<string>();

  const relativeToExcludeRoot = (abs: string): string => {
    const relative = toPosix(path.relative(excludeRoot, abs));
    return (relative === '..' || relative.startsWith('../') || relative.startsWith('..\\') || path.isAbsolute(relative)) ? '' : relative;
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
    const isProject = await isProjectDirFromEntries(dir, entries);
    projectCheckCache.set(dir, isProject);
    if (isProject) projectDirs.add(dir);

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
      if (entry.isFile() && RUST_FILE.test(entry.name) && !isExcluded(abs, false)) {
        addRustModule(rustModules, path.relative(scope, abs));
      }
    }
  }

  await walk(scope, 0);
  if (projectDirs.size === 0 && (await isProjectDir(fallbackDir))) {
    projectDirs.add(fallbackDir);
  }

  // Non-git scans keep the recursive index at the package, but every ancestor
  // up to the lookup boundary contributes its top-level modules (`lib/`).
  if (lookup !== scope) {
    let dir = scope;
    for (;;) {
      try {
        const outer = await readdir(dir, { withFileTypes: true });
        for (const entry of outer) {
          if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
          const abs = path.join(dir, entry.name);
          if (DEFAULT_IGNORE_DIRS.has(entry.name) || isExcluded(abs, entry.isDirectory())) continue;
          if (entry.isDirectory() && VALID_MODULE.test(entry.name)) {
            // Only directories that actually contain Python are import roots;
            // this keeps broad workspace names from becoming false negatives.
            if (await hasPythonFiles(abs)) localModules.add(entry.name);
          } else if (entry.isFile() && PYTHON_FILE.test(entry.name)) {
            const stem = entry.name.replace(PYTHON_FILE, '');
            if (VALID_MODULE.test(stem)) localModules.add(stem);
          }
        }
      } catch {
        // The lookup boundary may disappear between scans.
      }
      if (dir === lookup) break;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      const relative = path.relative(lookup, parent);
      if ((relative === '..' || relative.startsWith('../') || relative.startsWith('..\\') || path.isAbsolute(relative))) break;
      dir = parent;
    }
  }

  const loadProject = (dir: string): Promise<ProjectDeps> => {
    let pending = depsCache.get(dir);
    if (!pending) {
      pending = loadProjectDeps(dir).then(async (deps) => {
        deps.python.localModules = localModules;
        deps.rust.localModules = rustModules;
        deps.ignoredModules = ignoredModules;
        deps.repositoryDeclared = await repositoryDeclared();
        return deps;
      });
      depsCache.set(dir, pending);
    }
    return pending;
  };

  // The phantom-import rules claim a package is declared in no manifest at all,
  // so they also need the declarations of sibling projects in the same
  // repository. Loaded once per scan.
  let repositoryDeclaredPromise: Promise<{ python: Set<string>; node: Set<string> }> | undefined;
  const repositoryDeclared = (): Promise<{ python: Set<string>; node: Set<string> }> => {
    repositoryDeclaredPromise ??= (async () => {
      const python = new Set<string>();
      const node = new Set<string>();
      for (const dir of projectDirs) {
        const deps = await loadProjectDeps(dir);
        for (const name of deps.python.declared) python.add(name);
        for (const name of deps.node.declared) node.add(name);
        for (const name of deps.node.workspaces) node.add(name);
      }
      return { python, node };
    })();
    return repositoryDeclaredPromise;
  };

  const matchesLanguage = (deps: ProjectDeps, language: LanguageId): boolean =>
    language === 'python'
      ? deps.python.manifests.length > 0
      : language === 'go'
        ? deps.go.manifests.length > 0
        : language === 'rust'
          ? deps.rust.manifests.length > 0
          : deps.node.hasPackageJson;

  const fallback = (): Promise<ProjectDeps> => loadProject(fallbackDir);

  const registry: ProjectRegistry = {
    scopeRoot: scope,
    lookupRoot: lookup,
    projectDirs,
    async depsFor(fileAbs: string, language: LanguageId): Promise<ProjectDeps> {
      let dir = path.dirname(path.resolve(fileAbs));
      for (;;) {
        if (projectDirs.has(dir)) {
          const deps = await loadProject(dir);
          if (matchesLanguage(deps, language)) return deps;
        } else if (dir !== scope) {
          let isProject = projectCheckCache.get(dir);
          if (isProject === undefined) {
            isProject = await isProjectDir(dir);
            projectCheckCache.set(dir, isProject);
          }
          if (isProject) {
            projectDirs.add(dir);
            const deps = await loadProject(dir);
            if (matchesLanguage(deps, language)) return deps;
          }
        }
        if (dir === lookup) break;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return fallback();
    },
    async missingPackageJson(fileAbs: string, language: LanguageId): Promise<string | undefined> {
      if (language === 'python' || language === 'go' || language === 'rust') return undefined;
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
