import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { isProjectDir, loadProjectDeps } from './deps.ts';
import { DEFAULT_IGNORE_DIRS, toPosix } from './files.ts';
import type { ProjectDeps } from './types.ts';

const MAX_WALK_DEPTH = 12;
const PYTHON_FILE = /\.pyi?$/;
const VALID_MODULE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ProjectRegistry {
  scopeRoot: string;
  projects: Map<string, ProjectDeps>;
  fallback: ProjectDeps;
  /** Deps of the nearest project owning the file. */
  depsFor(fileAbs: string): ProjectDeps;
  /** One warning per project where TS phantom checks cannot run. */
  missingPackageJson(fileAbs: string): string | undefined;
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
 * One bounded walk finds every project under the scope root and indexes every
 * Python module, so a scan of `src/` can still resolve `lib/util.py`.
 */
export async function loadProjectRegistry(
  scopeRoot: string,
  fallbackRoot: string,
): Promise<ProjectRegistry> {
  const scope = path.resolve(scopeRoot);
  const fallbackDir = path.resolve(fallbackRoot);
  const projects = new Map<string, ProjectDeps>();
  const localModules = new Set<string>();
  const warnedProjects = new Set<string>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_WALK_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (await isProjectDir(dir)) projects.set(dir, await loadProjectDeps(dir));

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(entry.name)) continue;
        await walk(abs, depth + 1);
        continue;
      }
      if (entry.isFile() && PYTHON_FILE.test(entry.name)) {
        addPythonModule(localModules, path.relative(scope, abs));
      }
    }
  }

  await walk(scope, 0);
  if (projects.size === 0 && (await isProjectDir(fallbackDir))) {
    projects.set(fallbackDir, await loadProjectDeps(fallbackDir));
  }

  for (const deps of projects.values()) {
    deps.python.localModules = localModules;
  }
  const fallback = projects.get(fallbackDir) ?? (await loadProjectDeps(fallbackDir));
  fallback.python.localModules = localModules;

  const registry: ProjectRegistry = {
    scopeRoot: scope,
    projects,
    fallback,
    depsFor(fileAbs: string): ProjectDeps {
      let dir = path.dirname(path.resolve(fileAbs));
      for (;;) {
        const found = projects.get(dir);
        if (found) return found;
        if (dir === scope) break;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return fallback;
    },
    missingPackageJson(fileAbs: string): string | undefined {
      const deps = registry.depsFor(fileAbs);
      if (deps.node.hasPackageJson) return undefined;
      const project = deps.root;
      if (warnedProjects.has(project)) return undefined;
      warnedProjects.add(project);
      return `no package.json found for ${project}; TypeScript phantom imports are not checked for this project`;
    },
  };
  return registry;
}
