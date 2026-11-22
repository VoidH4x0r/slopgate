import type { AstNode } from './ast.ts';

/** Tree-sitter grammars we ship. */
export type LanguageId = 'python' | 'typescript' | 'tsx';

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
}

export interface Finding {
  ruleId: string;
  message: string;
  severity: Severity;
  confidence: Confidence;
  /** Repository-relative path, always with forward slashes. */
  file: string;
  start: Position;
  end: Position;
  /** Single-line excerpt of the offending source, trimmed and capped. */
  snippet: string;
  /** Facts a reviewer can check for themselves. */
  evidence: string[];
  help?: string;
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
  /** Repository-relative POSIX path. */
  file: string;
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

export interface ScanStats {
  files: number;
  byLanguage: Record<LanguageId, number>;
  skipped: number;
  parseErrors: number;
  durationMs: number;
}
