import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import type { LanguageId, SourceDialect } from './types.ts';

/** Directories that never contain code we want to lint. */
export const DEFAULT_IGNORE_DIRS: ReadonlySet<string> = new Set([
  '.git', '.hg', '.svn', '.idea', '.vscode',
  'node_modules', 'bower_components',
  'dist', 'build', 'out', 'target', 'bin', 'obj',
  'vendor', 'third_party', 'external',
  '.venv', 'venv', 'env', 'virtualenv', '.tox', '.eggs',
  'site-packages', 'dist-packages',
  '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.pytype',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', 'coverage',
  '.slopgate-cache',
]);

export const DEFAULT_INCLUDE: readonly string[] = [
  '**/*.py', '**/*.pyi',
  '**/*.ts', '**/*.mts', '**/*.cts', '**/*.tsx',
  '**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx',
  '**/*.go',
];

const EXTENSIONS: Readonly<
  Record<string, { language: LanguageId; dialect: SourceDialect }>
> = {
  '.py': { language: 'python', dialect: 'python' },
  '.pyi': { language: 'python', dialect: 'python' },
  '.ts': { language: 'typescript', dialect: 'typescript' },
  '.mts': { language: 'typescript', dialect: 'typescript' },
  '.cts': { language: 'typescript', dialect: 'typescript' },
  '.tsx': { language: 'tsx', dialect: 'tsx' },
  // JSX is legal in .js, and the tsx grammar is a superset of plain JS.
  '.js': { language: 'tsx', dialect: 'javascript' },
  '.jsx': { language: 'tsx', dialect: 'javascript' },
  '.mjs': { language: 'tsx', dialect: 'javascript' },
  '.cjs': { language: 'tsx', dialect: 'javascript' },
  '.go': { language: 'go', dialect: 'go' },
};

const MAX_FILE_BYTES = 1024 * 1024;

export interface SourceFile {
  /** Absolute path on disk. */
  abs: string;
  /** Path relative to the scan target, with forward slashes. */
  rel: string;
  /** Path relative to the config match root, with forward slashes. */
  matchRel: string;
  language: LanguageId;
  /** Human-facing dialect: `.js` is javascript even though it parses as tsx. */
  dialect: SourceDialect;
  size: number;
}

export interface DiscoverOptions {
  root: string;
  /** Base for include/exclude matching; defaults to the scan root. */
  matchRoot?: string;
  include?: readonly string[];
  exclude?: readonly string[];
  ignoreDirs?: readonly string[];
  maxBytes?: number;
}

export interface DiscoverResult {
  files: SourceFile[];
  skipped: number;
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Split `a,{b,c},d` on commas that are not inside braces. */
function splitAlternatives(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '{') {
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

function translateGlob(glob: string): string {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i] ?? '';
    if (ch === '{') {
      let depth = 0;
      let end = -1;
      for (let j = i; j < glob.length; j += 1) {
        if (glob[j] === '{') depth += 1;
        else if (glob[j] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end === -1) {
        re += '\\{';
        continue;
      }
      const alternatives = splitAlternatives(glob.slice(i + 1, end)).map(translateGlob);
      re += `(?:${alternatives.join('|')})`;
      i = end;
      continue;
    }
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          re += '(?:[^/]+/)*';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }
  return re;
}

/**
 * Translate a small glob dialect into a RegExp anchored at the whole path.
 * Supported: `**` (any depth), `*` (within one segment), `?`, and `{a,b}`
 * alternatives (nested braces allowed).
 */
export function globToRegExp(glob: string): RegExp {
  const normalized = toPosix(glob).replace(/^\.\//, '');
  return new RegExp('^' + translateGlob(normalized) + '$');
}

export function matchesAny(relPath: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((re) => re.test(relPath));
}

export function languageFor(fileName: string): LanguageId | undefined {
  if (fileName.endsWith('.d.ts') || fileName.endsWith('.d.mts') || fileName.endsWith('.d.cts')) {
    return undefined;
  }
  return EXTENSIONS[path.extname(fileName).toLowerCase()]?.language;
}

export function dialectFor(fileName: string): SourceDialect | undefined {
  if (fileName.endsWith('.d.ts') || fileName.endsWith('.d.mts') || fileName.endsWith('.d.cts')) {
    return undefined;
  }
  return EXTENSIONS[path.extname(fileName).toLowerCase()]?.dialect;
}

export async function discoverFiles(options: DiscoverOptions): Promise<DiscoverResult> {
  const root = path.resolve(options.root);
  const configuredMatchRoot = options.matchRoot ? path.resolve(options.matchRoot) : undefined;
  const includeRe = (options.include ?? DEFAULT_INCLUDE).map(globToRegExp);
  const excludeRe = (options.exclude ?? []).map(globToRegExp);
  const ignoreDirs = new Set([...DEFAULT_IGNORE_DIRS, ...(options.ignoreDirs ?? [])]);
  const maxBytes = options.maxBytes ?? MAX_FILE_BYTES;

  const files: SourceFile[] = [];
  let skipped = 0;

  // `slopgate src/app.py` scans a single file, not an empty directory walk.
  let rootInfo;
  try {
    rootInfo = await stat(root);
  } catch {
    return { files, skipped: 1 };
  }
  const matchRoot = configuredMatchRoot ?? (rootInfo.isFile() ? path.dirname(root) : root);
  const matchRelFor = (abs: string): string =>
    toPosix(path.relative(matchRoot, abs));

  if (rootInfo.isFile()) {
    const name = path.basename(root);
    const matchRel = matchRelFor(root);
    const language = languageFor(name);
    const dialect = dialectFor(name);
    if (!language || !dialect || !matchesAny(matchRel, includeRe) || matchesAny(matchRel, excludeRe)) {
      return { files, skipped: 1 };
    }
    if (rootInfo.size > maxBytes || rootInfo.size === 0) {
      return { files, skipped: 1 };
    }
    files.push({ abs: root, rel: name, matchRel, language, dialect, size: rootInfo.size });
    return { files, skipped };
  }

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = toPosix(path.relative(root, abs));
      const matchRel = matchRelFor(abs);

      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name) || matchesAny(matchRel + '/', excludeRe)) {
          continue;
        }
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (matchesAny(matchRel, excludeRe)) {
        skipped += 1;
        continue;
      }
      const language = languageFor(entry.name);
      const dialect = dialectFor(entry.name);
      if (!language || !dialect || !matchesAny(matchRel, includeRe)) {
        continue;
      }
      if (entry.name.endsWith('.min.js') || entry.name.endsWith('.min.mjs')) {
        skipped += 1;
        continue;
      }

      let info;
      try {
        info = await stat(abs);
      } catch {
        skipped += 1;
        continue;
      }
      if (info.size > maxBytes || info.size === 0) {
        skipped += 1;
        continue;
      }
      files.push({ abs, rel, matchRel, language, dialect, size: info.size });
    }
  }

  await walk(root);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files, skipped };
}
