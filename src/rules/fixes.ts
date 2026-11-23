import type { FixEdit } from '../types.ts';

/**
 * Delete a statement that occupies whole lines; otherwise delete only its
 * exact span. This avoids removing a `return` that shares a line with the
 * unreachable statement.
 */
export function statementDeletionEdit(source: string, node: { startIndex: number; endIndex: number }): FixEdit {
  const start = node.startIndex;
  const end = node.endIndex;
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextNewline = source.indexOf('\n', end);
  const lineEnd = nextNewline === -1 ? source.length : nextNewline;
  const before = source.slice(lineStart, start);
  // Python statements may be followed by a semicolon; the AST node excludes
  // it, so deleting only the node would leave a dangling `;`.
  const rest = source.slice(end, lineEnd);
  const semicolon = /^[ \t]*;[ \t]*/.exec(rest);
  const deleteEnd = semicolon ? end + semicolon[0].length : end;
  const after = source.slice(deleteEnd, lineEnd);
  if (/^[ \t\r]*$/.test(before) && /^[ \t\r]*$/.test(after)) {
    return {
      start: lineStart,
      end: nextNewline === -1 ? source.length : nextNewline + 1,
      replacement: '',
    };
  }
  return { start, end: deleteEnd, replacement: '' };
}

export function statementDeletionEdits(
  source: string,
  nodes: readonly { startIndex: number; endIndex: number }[],
): FixEdit[] {
  return nodes
    .map((node) => statementDeletionEdit(source, node))
    .sort((a, b) => a.start - b.start);
}
