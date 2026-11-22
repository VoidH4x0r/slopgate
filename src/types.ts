import type { AstNode } from './ast.ts';

/** Tree-sitter grammars we ship. */
export type LanguageId = 'python' | 'typescript' | 'tsx';

/** Human-facing source dialect, independent of the grammar used to parse it. */
export type SourceDialect = 'python' | 'javascript' | 'typescript' | 'tsx';

/** How sure we are that a finding is worth a human's time. */
export type Confidence = 'high' | 'medium' | 'low';

export type Severity = 'error' | 'warning' | 'info';

/** 1-based line, 1-based column. */
export interface Position {
  line: number;
  column: number;
}

/** A comment node's line span, used for "a comment explains this" decisions. */
export interface CommentRange {
  startLine: number;
  endLine: number;
  /** 1-based column of the comment marker, for standalone-comment checks. */
  startColumn: number;
}

export interface Finding {
  ruleId: string;
  message: string;
  severity: Severity;
  confidence: Confidence;
  /** Report-root-relative path, always with forward slashes. */
  file: string;
  start: Position;
  end: Position;
  /** Single-line excerpt of the offending source, trimmed and capped. */
  snippet: string;
  /** Facts a reviewer can check for themselves. */
  evidence: string[];
  help?: string;
}

/** A source edit produced by a rule, in BOM-stripped UTF-16 offsets. */
export interface FixEdit {
  start: number;
  end: number;
  replacement: string;
}

export interface RuleFix {
  edits: readonly FixEdit[];
}

/** What a rule returns; the engine fills in rule id, file and defaults. */
export interface RuleDraft {
  message: string;
  start: Position;
  end: Position;
  snippet?: string;
  evidence?: string[];
  help?: string;
  confidence?: Confidence;
  severity?: Severity;
  /** Safe, rule-authored edits; omitted for findings that must be fixed by hand. */
  fix?: RuleFix;
}

/** A project-level finding that carries its own report-relative file. */
export interface ProjectFindingDraft extends RuleDraft {
  file: string;
}

export interface RuleMeta {
  /** Namespaced id, e.g. `py/noop-test`. */
  id: string;
  title: string;
  summary: string;
  severity: Severity;
  confidence: Confidence;
  languages: LanguageId[];
  tags: string[];
  /** True when the rule emits a safe `fix` that `--fix` may apply. */
  fixable?: boolean;
}

export interface PythonDeps {
  declared: Set<string>;
  manifests: string[];
  /** Top-level module names that exist inside the repository. */
  localModules: Set<string>;
}

export interface NodeDeps {
  declared: Set<string>;
  workspaces: Set<string>;
  /** Import aliases declared in tsconfig `compilerOptions.paths`. */
  aliases: string[];
  hasPackageJson: boolean;
  /** Resolvable packages discovered in node_modules (top level and scoped). */
  installed: Set<string>;
}

export interface ProjectDeps {
  root: string;
  python: PythonDeps;
  node: NodeDeps;
  /** Module/package names the user told us to trust (`ignoreModules`). */
  ignoredModules: Set<string>;
}

export interface RuleContext {
  /** Report-root-relative POSIX path. */
  file: string;
  /** Full BOM-stripped source; offsets in fixes are UTF-16 code units. */
  source: string;
  lines: string[];
  root: AstNode;
  language: LanguageId;
  deps: ProjectDeps;
  /** Real comment nodes in this file; strings and regexes are not comments. */
  comments: readonly CommentRange[];
}

export interface Rule {
  meta: RuleMeta;
  run(ctx: RuleContext): RuleDraft[];
}

/** A rule that needs every parsed file before it can report. */
export interface ProjectRule {
  meta: RuleMeta;
  /** Clear per-scan state before the first collect. */
  reset(): void;
  /** Called once per cleanly parsed file. Do not retain the AST. */
  collect(ctx: RuleContext, source: string): void;
  /** Called after all files have been collected. */
  finish(): ProjectFindingDraft[];
}

/** A safe edit attached to one finding, used by the CLI fixer. */
export interface ScanFix {
  finding: Finding;
  fileAbs: string;
  /** SHA-1 of the BOM-stripped source the offsets were computed against. */
  sourceHash: string;
  edits: readonly FixEdit[];
}

export interface ScanStats {
  files: number;
  byLanguage: Record<SourceDialect, number>;
  skipped: number;
  parseErrors: number;
  durationMs: number;
}
