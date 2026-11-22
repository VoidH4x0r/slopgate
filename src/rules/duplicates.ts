import { createHash } from 'node:crypto';
import type { AstNode } from '../ast.ts';
import type {
  LanguageId,
  ProjectFindingDraft,
  ProjectRule,
  RuleMeta,
} from '../types.ts';
import { collapseWhitespace, endOf, isComment, isTestPath, snippetOf, startOf, walk } from './helpers.ts';

const MIN_DUPLICATE_LINES = 6;
const MIN_DUPLICATE_TOKENS = 15;

interface Candidate {
  language: LanguageId;
  file: string;
  line: number;
  start: ReturnType<typeof startOf>;
  end: ReturnType<typeof endOf>;
  snippet: string;
  signature: string;
  lines: number;
  tokens: number;
  kind: 'function' | 'method';
}

function bodyOf(node: AstNode): AstNode | undefined {
  if (node.type === 'function_definition') return node.childForFieldName('body') ?? undefined;
  if (
    node.type === 'function_declaration' ||
    node.type === 'method_definition' ||
    node.type === 'function_expression' ||
    node.type === 'arrow_function'
  ) {
    return node.childForFieldName('body') ?? undefined;
  }
  return undefined;
}

function isCandidate(node: AstNode, language: LanguageId): boolean {
  if (language === 'python') return node.type === 'function_definition';
  if (node.type === 'function_declaration' || node.type === 'method_definition') return true;
  if (node.type !== 'function_expression' && node.type !== 'arrow_function') return false;
  // A callback passed to map/filter is not a reusable duplicated function.
  const parent = node.parent;
  return parent?.type === 'variable_declarator' && parent.childForFieldName('value') === node;
}

/**
 * A normalized structural signature. Comments are ignored; whitespace is
 * collapsed; identifiers and literals are preserved. This deliberately reports
 * exact normalized copies, not renamed semantic clones.
 */
function signatureOf(body: AstNode): { signature: string; tokens: number } {
  const parts: string[] = [];
  let tokens = 0;
  walk(body, (node) => {
    if (isComment(node)) return false;
    parts.push(node.type);
    if (node.namedChildren.length === 0) {
      const text = collapseWhitespace(node.text);
      if (text.length > 0) {
        parts.push(text);
        tokens += 1;
      }
    }
    return true;
  });
  return { signature: parts.join('\u0000'), tokens };
}

function collectRule(kind: 'function' | 'method', language: LanguageId): ProjectRule {
  const candidates: Candidate[] = [];
  const meta: RuleMeta = {
    id: language === 'python' ? 'py/duplicate-block' : 'ts/duplicate-block',
    title: 'Duplicated function body',
    summary: 'Finds the same normalized function or method body in more than one file.',
    severity: 'warning',
    confidence: 'medium',
    languages: language === 'python' ? ['python'] : ['typescript', 'tsx'],
    tags: ['duplication'],
  };

  return {
    meta,
    reset() {
      candidates.length = 0;
    },
    collect(ctx) {
      if (ctx.language !== language || isTestPath(ctx.file)) return;
      for (const node of collectCandidates(ctx.root, language)) {
        if (!isCandidate(node, language)) continue;
        const body = bodyOf(node);
        if (!body || body.type === 'expression') continue;
        const lines = body.endPosition.row - body.startPosition.row + 1;
        if (lines < MIN_DUPLICATE_LINES) continue;
        const normalized = signatureOf(body);
        if (normalized.tokens < MIN_DUPLICATE_TOKENS) continue;
        candidates.push({
          language,
          file: ctx.file,
          line: node.startPosition.row + 1,
          start: startOf(node),
          end: endOf(node),
          snippet: snippetOf(ctx, node),
          signature: normalized.signature,
          lines,
          tokens: normalized.tokens,
          kind: node.type === 'method_definition' ? 'method' : kind,
        });
      }
    },
    finish() {
      const groups = new Map<string, Candidate[]>();
      for (const candidate of candidates) {
        const key = `${candidate.language}\u0000${createHash('sha256').update(candidate.signature).digest('hex')}`;
        const group = groups.get(key);
        if (group) group.push(candidate);
        else groups.set(key, [candidate]);
      }

      const drafts: ProjectFindingDraft[] = [];
      for (const group of groups.values()) {
        if (new Set(group.map((candidate) => candidate.file)).size < 2) continue;
        group.sort(
          (a, b) =>
            a.file.localeCompare(b.file) ||
            a.start.line - b.start.line ||
            a.start.column - b.start.column,
        );
        for (const candidate of group) {
          const others = group.filter((other) => other !== candidate);
          const firstOther = others[0];
          if (!firstOther) continue;
          drafts.push({
            file: candidate.file,
            message: `duplicates a ${candidate.lines}-line ${candidate.kind} body in \`${firstOther.file}:${firstOther.line}\``,
            start: candidate.start,
            end: candidate.end,
            snippet: candidate.snippet,
            evidence: [
              `identical normalized body (${candidate.tokens} tokens, ${candidate.lines} lines)`,
              `also at: ${others.map((other) => `${other.file}:${other.line}`).slice(0, 3).join(', ')}`,
            ],
            help: 'Extract the shared implementation, or add a comment explaining why the duplication is intentional.',
          });
        }
      }
      return drafts;
    },
  };
}

function collectCandidates(root: AstNode, language: LanguageId): AstNode[] {
  const wanted =
    language === 'python'
      ? new Set(['function_definition'])
      : new Set(['function_declaration', 'method_definition', 'function_expression', 'arrow_function']);
  const found: AstNode[] = [];
  walk(root, (node) => {
    if (wanted.has(node.type)) found.push(node);
  });
  return found;
}

export const duplicateRules: ProjectRule[] = [
  collectRule('function', 'python'),
  collectRule('function', 'typescript'),
];
