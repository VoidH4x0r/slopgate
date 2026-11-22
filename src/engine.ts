import { readFile, readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { asAst, type AstNode } from './ast.ts';
import { loadProjectDeps } from './deps.ts';
import { discoverFiles, type SourceFile } from './files.ts';
import { getParser } from './parser.ts';
import { ALL_RULES, RULE_BY_ID } from './rules/index.ts';
import { collectCommentRanges } from './rules/helpers.ts';
import { isSuppressed, readSuppressions } from './suppress.ts';
import type { Config } from './config.ts';
import type {
  Finding,
  ProjectDeps,
  RuleContext,
  RuleDraft,
  ScanStats,
  SourceDialect,
} from './types.ts';

export interface ScanOptions {
  root: string;
  config: Config;
  /** Directory that owns manifests and local modules; defaults to the scan root. */
  projectRoot?: string;
  /** When set, only these rule ids run (CLI `--rule`). */
  onlyRules?: ReadonlySet<string>;
}

export interface ScanResult {
  findings: Finding[];
  suppressedCount: number;
  stats: ScanStats;
  warnings: string[];
}

function collectLocalPythonModules(
  files: readonly SourceFile[],
  deps: ProjectDeps,
  projectRoot: string,
): void {
  const valid = /^[A-Za-z_][A-Za-z0-9_]*$/;
  for (const file of files) {
    if (file.language !== 'python') continue;
    const relative = path.relative(projectRoot, file.abs).replace(/\\/g, '/');
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    const parts = relative.split('/');
    const fileName = parts.pop() ?? '';
    for (const dir of parts) {
      if (valid.test(dir)) deps.python.localModules.add(dir);
    }
    // Every module stem, not just top-level ones: packages import their
    // siblings flat (`from util import x` inside `idlelib/`).
    const stem = fileName.replace(/\.pyi?$/, '');
    if (valid.test(stem)) deps.python.localModules.add(stem);
  }
}

/** A single-file scan still needs its same-directory siblings for imports. */
async function collectPythonSiblings(dir: string, deps: ProjectDeps): Promise<void> {
  const valid = /^[A-Za-z_][A-Za-z0-9_]*$/;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && valid.test(entry.name)) {
      deps.python.localModules.add(entry.name);
    } else if (entry.isFile() && /\.pyi?$/.test(entry.name)) {
      const stem = entry.name.replace(/\.pyi?$/, '');
      if (valid.test(stem)) deps.python.localModules.add(stem);
    }
  }
}

function toFinding(ruleId: string, draft: RuleDraft, defaults: { severity: Finding['severity']; confidence: Finding['confidence'] }, file: string): Finding {
  return {
    ruleId,
    message: draft.message,
    severity: draft.severity ?? defaults.severity,
    confidence: draft.confidence ?? defaults.confidence,
    file,
    start: draft.start,
    end: draft.end,
    snippet: draft.snippet ?? '',
    evidence: draft.evidence ?? [],
    ...(draft.help ? { help: draft.help } : {}),
  };
}

export async function scanProject(options: ScanOptions): Promise<ScanResult> {
  const started = performance.now();
  const target = path.resolve(options.root);
  const targetInfo = await stat(target).catch(() => undefined);
  // Scanning a single file still resolves manifests and local modules from the
  // project root, not just the file's directory.
  const root = targetInfo?.isFile() ? path.dirname(target) : target;
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : root;
  const warnings: string[] = [];
  const { config } = options;

  for (const ruleId of Object.keys(config.rules)) {
    if (!RULE_BY_ID.has(ruleId)) {
      throw new Error(
        `unknown rule in config: ${ruleId} (run \`slopgate rules\` to list the ${ALL_RULES.length} rule ids)`,
      );
    }
  }

  const deps = await loadProjectDeps(projectRoot);
  deps.ignoredModules = new Set(config.ignoreModules);

  const { files, skipped: skippedByDiscovery } = await discoverFiles({
    root: target,
    include: config.include,
    exclude: config.exclude,
  });
  collectLocalPythonModules(files, deps, projectRoot);
  if (targetInfo?.isFile()) await collectPythonSiblings(path.dirname(target), deps);

  const enabled = ALL_RULES.filter((rule) => {
    const setting = config.rules[rule.meta.id];
    if (setting === 'off') return false;
    if (options.onlyRules && !options.onlyRules.has(rule.meta.id)) return false;
    return true;
  });

  const byLanguage: Record<SourceDialect, number> = { python: 0, javascript: 0, typescript: 0, tsx: 0 };
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let suppressedCount = 0;
  let parseErrors = 0;
  let skipped = skippedByDiscovery;

  for (const file of files) {
    let buffer;
    try {
      buffer = await readFile(file.abs);
    } catch {
      skipped += 1;
      continue;
    }
    if (buffer.includes(0)) {
      skipped += 1;
      continue;
    }
    // Editors on Windows write a UTF-8 BOM; it must not shift line/column
    // numbers in findings.
    const source = buffer.toString('utf8').replace(/^\uFEFF/, '');
    byLanguage[file.dialect] += 1;

    const parser = await getParser(file.language);
    const tree = parser.parse(source);
    if (!tree) {
      parseErrors += 1;
      continue;
    }
    const hadParseError = tree.rootNode.hasError;
    if (hadParseError) parseErrors += 1;

    const root = asAst(tree.rootNode);
    const comments = collectCommentRanges(root);
    const ctx: RuleContext = {
      file: file.rel,
      lines: source.split(/\r?\n/),
      root,
      language: file.language,
      deps,
      comments,
    };
    const suppressions = readSuppressions(source, new Set(comments.map((comment) => comment.startLine)));

    for (const rule of enabled) {
      if (!rule.meta.languages.includes(file.language)) continue;
      let drafts: RuleDraft[];
      try {
        drafts = rule.run(ctx);
      } catch (error) {
        warnings.push(`${rule.meta.id} crashed on ${file.rel}: ${(error as Error).message}`);
        continue;
      }
      const configured = config.rules[rule.meta.id];
      const severity = configured && configured !== 'off' ? configured : rule.meta.severity;
      for (const draft of drafts) {
        const finding = toFinding(
          rule.meta.id,
          draft,
          { severity, confidence: rule.meta.confidence },
          file.rel,
        );
        // A file that did not parse cleanly has an unreliable structure: keep
        // the finding, but never claim high confidence about it.
        if (hadParseError && finding.confidence === 'high') {
          finding.confidence = 'medium';
          finding.evidence = [
            ...finding.evidence,
            'the file has syntax errors, so its structure may be misread',
          ];
        }
        if (isSuppressed(finding, suppressions)) {
          suppressedCount += 1;
          continue;
        }
        const key = `${finding.ruleId}|${finding.file}|${finding.start.line}|${finding.start.column}|${finding.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push(finding);
      }
    }

    const disposable = tree as unknown as { delete?: () => void };
    try {
      disposable.delete?.();
    } catch (error) {
      warnings.push(`could not free parse tree for ${file.rel}: ${(error as Error).message}`);
    }
  }

  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.start.line - b.start.line ||
      a.start.column - b.start.column ||
      a.ruleId.localeCompare(b.ruleId),
  );

  const stats: ScanStats = {
    files: byLanguage.python + byLanguage.javascript + byLanguage.typescript + byLanguage.tsx,
    byLanguage,
    skipped,
    parseErrors,
    durationMs: Math.round(performance.now() - started),
  };

  return { findings, suppressedCount, stats, warnings };
}
