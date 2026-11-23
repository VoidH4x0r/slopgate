import { createHash } from 'node:crypto';
import type { AstNode } from '../ast.ts';
import type {
  LanguageId,
  ProjectFindingDraft,
  ProjectRule,
  RuleMeta,
} from '../types.ts';
import { collapseWhitespace, endOf, isComment, isTestPath, snippetOf, startOf, walk } from './helpers.ts';
import { hasBuildConstraint, isGeneratedGo } from './go.ts';

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
  exactHash: string;
  lines: number;
  tokens: number;
  kind: 'function' | 'method';
  ancestor?: Candidate;
}

function bodyOf(node: AstNode): AstNode | undefined {
  if (node.type === 'function_definition') return node.childForFieldName('body') ?? undefined;
  if (
    node.type === 'function_declaration' ||
    node.type === 'method_declaration' ||
    node.type === 'function_item' ||
    node.type === 'method_definition' ||
    node.type === 'function_expression' ||
    node.type === 'arrow_function' ||
    node.type === 'generator_function_declaration' ||
    node.type === 'generator_function'
  ) {
    return node.childForFieldName('body') ?? undefined;
  }
  return undefined;
}

function isCandidate(node: AstNode, language: LanguageId): boolean {
  if (language === 'python') return node.type === 'function_definition';
  if (language === 'go') {
    return node.type === 'function_declaration' || node.type === 'method_declaration';
  }
  if (language === 'rust') return node.type === 'function_item';
  if (node.type === 'function_declaration' || node.type === 'method_definition') return true;
  if (node.type === 'generator_function_declaration') return true;
  if (
    node.type !== 'function_expression' &&
    node.type !== 'arrow_function' &&
    node.type !== 'generator_function'
  ) {
    return false;
  }
  // A callback passed to map/filter is not a reusable duplicated function.
  const parent = node.parent;
  const value = parent?.type === 'variable_declarator' ? parent.childForFieldName('value') : undefined;
  return Boolean(
    value && value.startIndex === node.startIndex && value.endIndex === node.endIndex,
  );
}

const FUNCTION_NODE_TYPES = new Set([
  'function_definition',
  'function_declaration',
  'method_declaration',
  'function_item',
  'method_definition',
  'function_expression',
  'arrow_function',
  'generator_function_declaration',
  'generator_function',
]);

function nodeKey(node: AstNode): string {
  return `${node.startIndex}:${node.endIndex}`;
}

function nearestCandidateAncestor(
  node: AstNode,
  byNode: ReadonlyMap<string, Candidate>,
): Candidate | undefined {
  let current = node.parent;
  while (current) {
    if (FUNCTION_NODE_TYPES.has(current.type)) {
      const candidate = byNode.get(nodeKey(current));
      if (candidate) return candidate;
    }
    current = current.parent;
  }
  return undefined;
}

function signaturePair(body: AstNode): {
  exactHash: string;
  semanticHash: string;
  tokens: number;
} {
  const exact = createHash('sha256');
  const semantic = createHash('sha256');
  let tokens = 0;
  const stack: AstNode[] = [body];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || isComment(node)) continue;
    exact.update(node.type);
    exact.update('\u0000');
    semantic.update(node.type);
    semantic.update('\u0000');
    if (node.children.length === 0) {
      const raw = node.text;
      const exactText = /(?:string_content|string_fragment|regex_pattern|comment)$/.test(node.type)
        ? raw
        : collapseWhitespace(raw);
      if (exactText.length > 0) {
        exact.update(exactText);
        exact.update('\u0000');
        semantic.update(semanticLeaf(node, collapseWhitespace(raw)));
        semantic.update('\u0000');
        tokens += 1;
      }
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      if (child) stack.push(child);
    }
  }
  return { exactHash: exact.digest('hex'), semanticHash: semantic.digest('hex'), tokens };
}

function semanticLeaf(node: AstNode, text: string): string {
  if (/identifier$/i.test(node.type)) return '<id>';
  if (/literal|string|number|float|integer|boolean|^true$|^false$|^nil$|^none$|^null$/i.test(node.type)) {
    return '<literal>';
  }
  return text;
}

function collectRule(
  kind: 'function' | 'method',
  language: LanguageId,
  mode: 'exact' | 'semantic' = 'exact',
): ProjectRule {
  const candidates: Candidate[] = [];
  const prefix =
    language === 'python' ? 'py' : language === 'go' ? 'go' : language === 'rust' ? 'rs' : 'ts';
  const meta: RuleMeta = {
    id: mode === 'semantic' ? `${prefix}/semantic-duplicate` : `${prefix}/duplicate-block`,
    title: mode === 'semantic' ? 'Semantically duplicated function body' : 'Duplicated function body',
    summary:
      mode === 'semantic'
        ? 'Finds the same normalized structure after replacing identifiers and literals, in more than one file.'
        : 'Finds the same normalized function or method body in more than one file.',
    severity: 'warning',
    confidence: 'medium',
    languages:
      language === 'python'
        ? ['python']
        : language === 'go'
          ? ['go']
          : language === 'rust'
            ? ['rust']
            : ['typescript', 'tsx'],
    tags: ['duplication'],
  };

  return {
    meta,
    reset() {
      candidates.length = 0;
    },
    collect(ctx) {
      const matchesLanguage =
        language === 'typescript'
          ? ctx.language === 'typescript' || ctx.language === 'tsx'
          : ctx.language === language;
      if (!matchesLanguage || isTestPath(ctx.file)) return;
      if (
        language === 'go' &&
        (isGeneratedGo(ctx) || hasBuildConstraint(ctx))
      ) {
        return;
      }
      if (
        language === 'rust' &&
        /^(?:\/\/\s*@generated|\/\/ Code generated .* DO NOT EDIT\.)$/m.test(ctx.source)
      ) {
        return;
      }
      const byNode = new Map<string, Candidate>();
      for (const node of collectCandidates(ctx.root, language)) {
        if (!isCandidate(node, language)) continue;
        const body = bodyOf(node);
        if (!body || body.type === 'expression') continue;
        const lines = body.endPosition.row - body.startPosition.row + 1;
        if (lines < MIN_DUPLICATE_LINES) continue;
        const signatures = signaturePair(body);
        if (signatures.tokens < MIN_DUPLICATE_TOKENS) continue;
        const candidate: Candidate = {
          language,
          file: ctx.file,
          line: node.startPosition.row + 1,
          start: startOf(node),
          end: endOf(node),
          snippet: snippetOf(ctx, node),
          hash: mode === 'semantic' ? signatures.semanticHash : signatures.exactHash,
          exactHash: signatures.exactHash,
          lines,
          tokens: signatures.tokens,
          kind: node.type === 'method_definition' || node.type === 'method_declaration' ? 'method' : kind,
        };
        const ancestor = nearestCandidateAncestor(node, byNode);
        if (ancestor) candidate.ancestor = ancestor;
        byNode.set(nodeKey(node), candidate);
        candidates.push(candidate);
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

      const duplicated = new Set<Candidate>();
      for (const group of groups.values()) {
        if (new Set(group.map((candidate) => candidate.file)).size >= 2) {
          for (const candidate of group) duplicated.add(candidate);
        }
      }

      const exactGroups = new Map<string, Candidate[]>();
      for (const candidate of candidates) {
        const key = `${candidate.language}\u0000${candidate.exactHash}`;
        const group = exactGroups.get(key);
        if (group) group.push(candidate);
        else exactGroups.set(key, [candidate]);
      }
      const exactDuplicated = new Set<Candidate>();
      for (const group of exactGroups.values()) {
        if (new Set(group.map((candidate) => candidate.file)).size >= 2) {
          for (const candidate of group) exactDuplicated.add(candidate);
        }
      }

      const drafts: ProjectFindingDraft[] = [];
      for (const group of groups.values()) {
        const eligible = group.filter((candidate) => {
          let ancestor = candidate.ancestor;
          while (ancestor) {
            if (duplicated.has(ancestor)) return false;
            ancestor = ancestor.ancestor;
          }
          return true;
        });
        const byFile = new Map<string, Candidate>();
        for (const candidate of eligible) {
          if (!byFile.has(candidate.file)) byFile.set(candidate.file, candidate);
        }
        if (byFile.size < 2) continue;
        const allRepresentatives = [...byFile.values()].sort(
          (a, b) =>
            a.file.localeCompare(b.file) ||
            a.start.line - b.start.line ||
            a.start.column - b.start.column,
        );
        // Exact duplicates are already reported by duplicate-block. Semantic
        // still reports the renamed member of the group but uses an exact
        // member as the "also at" location, so the semantic group is not lost.
        const representatives =
          mode === 'semantic'
            ? allRepresentatives.filter((candidate) => !exactDuplicated.has(candidate))
            : allRepresentatives;
        for (const candidate of representatives) {
          const others = allRepresentatives.filter((other) => other.file !== candidate.file);
          const firstOther = others[0];
          if (!firstOther) continue;
          drafts.push({
            file: candidate.file,
            message:
              mode === 'semantic'
                ? `semantically duplicates a ${candidate.lines}-line ${candidate.kind} body in \`${firstOther.file}:${firstOther.line}\``
                : `duplicates a ${candidate.lines}-line ${candidate.kind} body in \`${firstOther.file}:${firstOther.line}\``,
            start: candidate.start,
            end: candidate.end,
            snippet: candidate.snippet,
            evidence: [
              mode === 'semantic'
                ? `same structure after normalizing identifiers and literals (${candidate.tokens} tokens, ${candidate.lines} lines)`
                : `identical normalized body (${candidate.tokens} tokens, ${candidate.lines} lines)`,
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
      : language === 'go'
        ? new Set(['function_declaration', 'method_declaration'])
        : language === 'rust'
          ? new Set(['function_item'])
          : new Set([
              'function_declaration',
              'method_definition',
              'function_expression',
              'arrow_function',
              'generator_function_declaration',
              'generator_function',
            ]);
  const found: AstNode[] = [];
  walk(root, (node) => {
    if (wanted.has(node.type)) found.push(node);
  });
  return found;
}

export function createDuplicateRules(): ProjectRule[] {
  return [
    collectRule('function', 'python'),
    collectRule('function', 'typescript'),
    collectRule('function', 'go'),
    collectRule('function', 'rust'),
  ];
}

export function createSemanticDuplicateRules(): ProjectRule[] {
  return [
    collectRule('function', 'python', 'semantic'),
    collectRule('function', 'typescript', 'semantic'),
    collectRule('function', 'go', 'semantic'),
    collectRule('function', 'rust', 'semantic'),
  ];
}

export const duplicateRules: ProjectRule[] = createDuplicateRules();
export const semanticDuplicateRules: ProjectRule[] = createSemanticDuplicateRules();
