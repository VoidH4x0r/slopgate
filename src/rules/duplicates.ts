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
  hash: string;
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

const FUNCTION_NODE_TYPES = new Set([
  'function_definition',
  'function_declaration',
  'method_definition',
  'function_expression',
  'arrow_function',
]);

/** Nested helpers are covered when their enclosing function is duplicated. */
function hasFunctionAncestor(node: AstNode): boolean {
  let current = node.parent;
  while (current) {
    if (FUNCTION_NODE_TYPES.has(current.type)) return true;
    current = current.parent;
  }
  return false;
}

/**
 * A normalized structural signature. Comments are ignored; whitespace is
 * collapsed; identifiers, literals **and anonymous operators** are preserved.
 * This deliberately reports exact normalized copies, not renamed semantic
 * clones.
 */
function signatureOf(body: AstNode): { hash: string; tokens: number } {
  const hash = createHash('sha256');
  let tokens = 0;
  const stack: AstNode[] = [body];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || isComment(node)) continue;
    hash.update(node.type);
    hash.update('\u0000');
    if (node.children.length === 0) {
      const text = collapseWhitespace(node.text);
      if (text.length > 0) {
        hash.update(text);
        hash.update('\u0000');
        tokens += 1;
      }
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      if (child) stack.push(child);
    }
  }
  return { hash: hash.digest('hex'), tokens };
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
        if (!isCandidate(node, language) || hasFunctionAncestor(node)) continue;
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
          hash: normalized.hash,
          lines,
          tokens: normalized.tokens,
          kind: node.type === 'method_definition' ? 'method' : kind,
        });
      }
    },
    finish() {
      const groups = new Map<string, Candidate[]>();
      for (const candidate of candidates) {
        const key = `${candidate.language}\u0000${candidate.hash}`;
        const group = groups.get(key);
        if (group) group.push(candidate);
        else groups.set(key, [candidate]);
      }

      const drafts: ProjectFindingDraft[] = [];
      for (const group of groups.values()) {
        const byFile = new Map<string, Candidate>();
        for (const candidate of group) {
          if (!byFile.has(candidate.file)) byFile.set(candidate.file, candidate);
        }
        if (byFile.size < 2) continue;
        const representatives = [...byFile.values()].sort(
          (a, b) =>
            a.file.localeCompare(b.file) ||
            a.start.line - b.start.line ||
            a.start.column - b.start.column,
        );
        for (const candidate of representatives) {
          const others = representatives.filter((other) => other.file !== candidate.file);
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
