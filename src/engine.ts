import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { asAst, type AstNode } from './ast.ts';
import { discoverFiles, toPosix } from './files.ts';
import { getParser } from './parser.ts';
import { loadProjectRegistry, type ProjectRegistry } from './projects.ts';
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
  /** Nearest project root for the target; manifests are resolved per file. */
  projectRoot?: string;
  /** Directory that owns the active `.slopgate.json`; config globs are relative to it. */
  configRoot?: string;
  /** Root to index for projects/local modules; defaults to projectRoot. */
  indexRoot?: string;
  /** Outer boundary for lazy ancestor-project lookup; defaults to indexRoot. */
  lookupRoot?: string;
  /** Prebuilt registry (MCP caches this across tool calls). */
  registry?: ProjectRegistry;
  /** Root for reported finding paths; defaults to the scan base. */
  reportRoot?: string;
  /** When set, only these rule ids run (CLI `--rule`). */
  onlyRules?: ReadonlySet<string>;
}

export interface ScanResult {
  findings: Finding[];
  /** Report-root-relative files that were scanned (including parse failures). */
  files: string[];
  suppressedCount: number;
  stats: ScanStats;
  warnings: string[];
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
  const indexRoot = options.indexRoot ? path.resolve(options.indexRoot) : projectRoot;
  const lookupRoot = options.lookupRoot ? path.resolve(options.lookupRoot) : indexRoot;
  const reportRoot = options.reportRoot ? path.resolve(options.reportRoot) : root;
  const warnings: string[] = [];
  const { config } = options;

  for (const ruleId of Object.keys(config.rules)) {
    if (!RULE_BY_ID.has(ruleId)) {
      throw new Error(
        `unknown rule in config: ${ruleId} (run \`slopgate rules\` to list the ${ALL_RULES.length} rule ids)`,
      );
    }
  }

  const registry =
    options.registry ??
    (await loadProjectRegistry({
      scopeRoot: indexRoot,
      lookupRoot,
      fallbackRoot: projectRoot,
      ...(options.configRoot ? { configRoot: path.resolve(options.configRoot) } : {}),
      exclude: config.exclude,
      ignoreModules: config.ignoreModules,
    }));

  const { files, skipped: skippedByDiscovery } = await discoverFiles({
    root: target,
    matchRoot: options.configRoot ? path.resolve(options.configRoot) : projectRoot,
    include: config.include,
    exclude: config.exclude,
  });

  const enabled = ALL_RULES.filter((rule) => {
    const setting = config.rules[rule.meta.id];
    if (setting === 'off') return false;
    if (options.onlyRules && !options.onlyRules.has(rule.meta.id)) return false;
    return true;
  });

  const byLanguage: Record<SourceDialect, number> = { python: 0, javascript: 0, typescript: 0, tsx: 0 };
  const findings: Finding[] = [];
  const scannedFiles: string[] = [];
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
    const reportRelative = toPosix(path.relative(reportRoot, file.abs));
    const findingFile =
      reportRelative.startsWith('..') || path.isAbsolute(reportRelative)
        ? file.rel
        : reportRelative;
    scannedFiles.push(findingFile);

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
    const commentLines = new Set<number>();
    for (const comment of comments) {
      for (let line = comment.startLine; line <= comment.endLine; line += 1) {
        commentLines.add(line);
      }
    }
    const deps = await registry.depsFor(file.abs, file.language);
    if (file.language !== 'python') {
      const missing = await registry.missingPackageJson(file.abs, file.language);
      if (missing) warnings.push(missing);
    }
    const ctx: RuleContext = {
      file: findingFile,
      lines: source.split(/\r?\n/),
      root,
      language: file.language,
      deps,
      comments,
    };
    const suppressions = readSuppressions(source, commentLines);

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
          findingFile,
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

  return { findings, files: scannedFiles, suppressedCount, stats, warnings };
}
