import type { AstNode } from '../ast.ts';
import type { CommentRange, Position, RuleContext } from '../types.ts';

export function startOf(node: AstNode): Position {
  return { line: node.startPosition.row + 1, column: node.startPosition.column + 1 };
}

export function endOf(node: AstNode): Position {
  return { line: node.endPosition.row + 1, column: node.endPosition.column + 1 };
}

/** Trimmed first line of a node, capped for display. */
export function snippetOf(_ctx: RuleContext, node: AstNode): string {
  const firstLine = node.text.split(/\r?\n/, 1)[0] ?? '';
  const trimmed = firstLine.trim();
  if (trimmed.length <= 160) return trimmed;
  return trimmed.slice(0, 157) + '...';
}

export function isComment(node: AstNode): boolean {
  return node.type === 'comment' || node.type === 'line_comment' || node.type === 'block_comment';
}

/** Named children that are actual statements (comments excluded). */
export function statementsOf(block: AstNode): AstNode[] {
  return block.namedChildren.filter((child) => !isComment(child));
}

/** Depth-limited, allocation-light walk over named children. */
export function walk(
  node: AstNode,
  visit: (node: AstNode, depth: number) => boolean | void,
  maxDepth = 400,
): void {
  const stack: Array<{ node: AstNode; depth: number }> = [{ node, depth: 0 }];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    const { node: current, depth } = entry;
    const descend = visit(current, depth);
    if (descend === false || depth >= maxDepth) continue;
    const children = current.namedChildren;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (child) stack.push({ node: child, depth: depth + 1 });
    }
  }
}

export function descendantsOfType(root: AstNode, types: readonly string[]): AstNode[] {
  const wanted = new Set(types);
  const found: AstNode[] = [];
  walk(root, (node) => {
    if (wanted.has(node.type)) found.push(node);
  });
  return found;
}

/** Nearest ancestor whose type is in `types` (excluding the node itself). */
export function ancestorOfType(node: AstNode, types: readonly string[]): AstNode | undefined {
  const wanted = new Set(types);
  let current = node.parent;
  while (current) {
    if (wanted.has(current.type)) return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * Real comment nodes in the tree. A `//` inside a string or a `#` inside a URL
 * is not a comment, so rules must not scan raw source text for these markers.
 */
export function collectCommentRanges(root: AstNode): CommentRange[] {
  return descendantsOfType(root, ['comment', 'line_comment', 'block_comment']).map((node) => ({
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  }));
}

/**
 * True when a real comment overlaps the given line range. Comments before the
 * first statement of a block are often attached to the parent node, so callers
 * pass the enclosing statement's range (for example the whole `try`, not just
 * the `except` clause).
 */
export function hasCommentBetween(ctx: RuleContext, fromLine: number, toLine: number): boolean {
  return ctx.comments.some((comment) => comment.startLine <= toLine && comment.endLine >= fromLine);
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function truncate(value: string, max: number): string {
  const single = collapseWhitespace(value);
  return single.length <= max ? single : single.slice(0, max - 3) + '...';
}

/**
 * Test files and fixtures are full of intentional stubs, dead branches and
 * swallowed errors (they are testing those behaviours). Rules that are not
 * test-specific skip them; `py/noop-test` and `ts/noop-test` are the rules
 * that look at tests themselves.
 */
export function isTestPath(file: string): boolean {
  const lower = file.toLowerCase();
  const parts = lower.split('/');
  const base = parts[parts.length - 1] ?? '';
  if (/^test_.*\.pyi?$/.test(base) || /_tests?\.pyi?$/.test(base)) return true;
  if (/\.(test|spec)\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(base)) return true;
  // Test/build infrastructure that pytest, nox and Sphinx import directly.
  if (base === 'conftest.py' || base === 'noxfile.py') return true;
  if (lower === 'docs/conf.py' || lower.endsWith('/docs/conf.py')) return true;
  return parts.some((part) => part === 'test' || part === 'tests' || part === '__tests__');
}

/** Type stubs declare every function with `...`; stub rules must not fire. */
export function isStubFile(file: string): boolean {
  return file.toLowerCase().endsWith('.pyi');
}

/**
 * Modules whose whole purpose is to provide no-op stand-ins (CPython's
 * `multiprocessing/dummy`, `dummy_threading.py`). Directory names must match
 * exactly; file names may use the `dummy_`/`noop_` convention. `dummy_data/`
 * is a normal package and `shims/` can contain unfinished code.
 */
const NOOP_DIRS = new Set(['dummy', '_dummy', 'noop', 'no_op', 'no-op']);

export function isNoopModulePath(file: string): boolean {
  const parts = file.toLowerCase().split('/');
  if (parts.slice(0, -1).some((part) => NOOP_DIRS.has(part))) return true;
  const stem = (parts[parts.length - 1] ?? '').replace(/\.pyi?$/, '');
  return /^_?(dummy|noop|no_op|no-op)(_|$)/.test(stem);
}

/** True when the file name follows a test-module convention. */
export function looksLikeTestModule(file: string): boolean {
  const base = (file.split('/').pop() ?? '').toLowerCase();
  return (
    /^test_.*\.pyi?$/.test(base) ||
    /_tests?\.pyi?$/.test(base) ||
    /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(base)
  );
}

/** Text of the function's leading docstring, if it has one. */
export function docstringOf(fn: AstNode): string | undefined {
  const body = fn.childForFieldName('body');
  const first = body?.namedChildren.find((child) => !isComment(child));
  if (first?.type !== 'expression_statement') return undefined;
  const value = first.namedChildren[0];
  return value?.type === 'string' ? value.text : undefined;
}

/** True when the function's body starts with a docstring. */
export function hasDocstring(fn: AstNode): boolean {
  const body = fn.childForFieldName('body');
  const first = body?.namedChildren.find((child) => !isComment(child));
  return first?.type === 'expression_statement' && first.namedChildren[0]?.type === 'string';
}

/** True when the node sits inside `if __name__ == "__main__":`. */
export function insideMainGuard(node: AstNode): boolean {
  let current: AstNode | null = node.parent;
  while (current) {
    if (current.type === 'if_statement') {
      const condition = current.childForFieldName('condition');
      if (condition && /__name__/.test(condition.text)) return true;
    }
    current = current.parent;
  }
  return false;
}

const CLEANUP_NAMES = new Set([
  'close',
  '__del__',
  '__exit__',
  'cleanup',
  '_cleanup',
  'shutdown',
  'stop',
  'cancel',
  'dispose',
  'finalize',
  'teardown',
  'tearDown',
  'reset',
]);

/** Cleanup/finaliser code swallows errors on purpose; treat it as medium. */
export function insideCleanupFunction(node: AstNode): boolean {
  const fn = ancestorOfType(node, ['function_definition', 'method_definition', 'function_declaration']);
  const name = fn?.childForFieldName('name')?.text;
  return name !== undefined && name !== null && CLEANUP_NAMES.has(name);
}
