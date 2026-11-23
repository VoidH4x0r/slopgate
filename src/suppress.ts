import type { CommentRange, Finding } from './types.ts';

const NEXT_LINE = /slopgate-ignore-next-line\b(.*)$/;
const SAME_LINE = /slopgate-ignore-line\b(.*)$/;
const FILE = /slopgate-disable-file\b/;

export interface Suppressions {
  fileDisabled: boolean;
  /** 1-based line -> rule ids, or 'all'. */
  lineRules: Map<number, Set<string> | 'all'>;
}

function ruleList(raw: string): Set<string> | 'all' {
  const cleaned = raw.replace(/^[:\s]+/, '').replace(/[*/-]+\/?\s*$/, '').trim();
  if (!cleaned || cleaned === '*' || cleaned === 'all') return 'all';
  const ids = cleaned
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => /^[a-z]{2}\/[a-z0-9-]+$/.test(part));
  // A typo such as `py/stub-boddy` must not silently suppress the whole line.
  return new Set(ids);
}

/** First real code line after a comment block, skipping decorators. */
function nextCodeLine(lines: readonly string[], startIndex: number): number | undefined {
  let decoratorDepth = 0;
  for (let index = startIndex; index < lines.length; index += 1) {
    const text = (lines[index] ?? '').trim();
    if (decoratorDepth > 0) {
      decoratorDepth += (text.match(/\(/g) ?? []).length - (text.match(/\)/g) ?? []).length;
      continue;
    }
    if (
      text.length === 0 ||
      text.startsWith('#') ||
      text.startsWith('//') ||
      text.startsWith('/*') ||
      text.startsWith('*')
    ) {
      continue;
    }
    if (text.startsWith('@')) {
      decoratorDepth = (text.match(/\(/g) ?? []).length - (text.match(/\)/g) ?? []).length;
      if (decoratorDepth > 0) continue;
      // A decorator without parentheses still applies to the next line.
      continue;
    }
    return index + 1;
  }
  return undefined;
}

/**
 * @param commentLines 1-based lines that actually contain a comment node.
 * @param comments AST comment ranges. When supplied, directives are matched
 *   against the comment text only, so a string literal cannot disable a file.
 */
export function readSuppressions(
  source: string,
  commentLines?: ReadonlySet<number>,
  comments?: readonly CommentRange[],
): Suppressions {
  const suppressions: Suppressions = { fileDisabled: false, lineRules: new Map() };
  // Most files contain no directives; avoid splitting and indexing comments.
  if (!source.includes('slopgate-')) return suppressions;
  const lines = source.split(/\r?\n/);

  const commentByLine = new Map<number, string[]>();
  if (comments && comments.length > 0) {
    for (const comment of comments) {
      for (let lineNumber = comment.startLine; lineNumber <= comment.endLine; lineNumber += 1) {
        const raw = lines[lineNumber - 1] ?? '';
        const start = lineNumber === comment.startLine ? comment.startColumn - 1 : 0;
        const end = lineNumber === comment.endLine ? comment.endColumn - 1 : raw.length;
        const bucket = commentByLine.get(lineNumber) ?? [];
        bucket.push(raw.slice(start, Math.max(start, end)));
        commentByLine.set(lineNumber, bucket);
      }
    }
  }
  const addRules = (target: number, rules: Set<string> | 'all'): void => {
    const existing = suppressions.lineRules.get(target);
    if (!existing || existing === 'all' || rules === 'all') {
      suppressions.lineRules.set(target, existing === 'all' || rules === 'all' ? 'all' : rules);
      return;
    }
    for (const rule of rules) existing.add(rule);
  };
  const commentText = (lineNumber: number, line: string): string => {
    if (!comments || comments.length === 0) return line;
    return (commentByLine.get(lineNumber) ?? []).join('\n');
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    if (commentLines && !commentLines.has(lineNumber)) continue;
    const line = commentText(lineNumber, lines[index] ?? '');
    if (FILE.test(line)) {
      suppressions.fileDisabled = true;
      continue;
    }
    const next = NEXT_LINE.exec(line);
    if (next) {
      const target = nextCodeLine(lines, index + 1) ?? index + 2;
      addRules(target, ruleList(next[1] ?? ''));
      continue;
    }
    const same = SAME_LINE.exec(line);
    if (same && !next) {
      addRules(index + 1, ruleList(same[1] ?? ''));
    }
  }
  return suppressions;
}

export function isSuppressed(finding: Finding, suppressions: Suppressions): boolean {
  if (suppressions.fileDisabled) return true;
  const rules = suppressions.lineRules.get(finding.start.line);
  if (!rules) return false;
  if (rules === 'all') return true;
  return rules.has(finding.ruleId);
}
