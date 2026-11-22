import { builtinModules } from 'node:module';
import type { AstNode } from '../ast.ts';
import type { Rule, RuleContext, RuleDraft } from '../types.ts';
import {
  ancestorOfType,
  collapseWhitespace,
  descendantsOfType,
  endOf,
  hasCommentBetween,
  isComment,
  isTestPath,
  snippetOf,
  startOf,
  truncate,
  walk,
} from './helpers.ts';

const NODE_BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

const ASSET_SPECIFIER =
  /\.(css|scss|sass|less|styl|svg|png|jpe?g|gif|webp|avif|ico|json|wasm|mdx?|txt|graphql|gql|vue|svelte|astro|html?)(\?.*)?$/i;
const VIRTUAL_SPECIFIER = /^(virtual|vite|webpack|bun|deno|astro|parcel|rollup|pnp|data|file|https?|blob):/;

const TERMINATORS = new Set([
  'return_statement',
  'throw_statement',
  'break_statement',
  'continue_statement',
]);

function stringLiteralValue(node: AstNode | null | undefined): string | undefined {
  if (!node || node.type !== 'string') return undefined;
  const raw = node.text;
  if (raw.length < 2) return undefined;
  return raw.slice(1, -1);
}

function sourceString(node: AstNode): string | undefined {
  const field = node.childForFieldName('source');
  const fromField = stringLiteralValue(field);
  if (fromField !== undefined) return fromField;
  for (let i = node.namedChildren.length - 1; i >= 0; i -= 1) {
    const child = node.namedChildren[i];
    const value = stringLiteralValue(child);
    if (value !== undefined) return value;
  }
  return undefined;
}

interface ImportRef {
  node: AstNode;
  specifier: string;
}

function moduleSpecifiers(root: AstNode): ImportRef[] {
  const refs: ImportRef[] = [];
  walk(root, (node) => {
    if (node.type === 'import_statement' || node.type === 'export_statement') {
      const specifier = sourceString(node);
      if (specifier) refs.push({ node, specifier });
      return false;
    }
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      const fnName = fn ? collapseWhitespace(fn.text) : '';
      if (fnName === 'require' || fnName === 'import') {
        const args = node.childForFieldName('arguments');
        const specifier = stringLiteralValue(args?.namedChildren[0]);
        if (specifier) refs.push({ node, specifier });
      }
    }
    return true;
  });
  return refs;
}

function packageRootOf(specifier: string): string {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0] ?? specifier;
}

function matchesAlias(specifier: string, aliases: readonly string[]): boolean {
  return aliases.some((alias) => {
    const clean = alias.replace(/\/+$/, '');
    return specifier === clean || specifier.startsWith(`${clean}/`);
  });
}

const ASSERTION_ROOTS = new Set(['assert', 'expect', 'expectTypeOf', 'should', 'chai']);

const T_ASSERTION_MEMBERS = new Set([
  'ok',
  'is',
  'not',
  'same',
  'throws',
  'rejects',
  'match',
  'snapshot',
  'pass',
  'fail',
  'assert',
]);

/**
 * Test whether a call is an assertion. The full callee path matters:
 * `assert.strictEqual` ends in `strictEqual`, which the old last-segment
 * regex missed, so node:assert-based tests were reported as assertion-free.
 */
function isAssertionCallee(text: string): boolean {
  if (text.length === 0) return false;
  // node:assert and node:assert/strict: assert(...) plus every method.
  if (text === 'assert' || text.startsWith('assert.')) return true;
  // Bare helpers such as assertEqual/assertNotNull/assertTruthy.
  if (/^assert[A-Z][A-Za-z0-9_$]*$/.test(text)) return true;
  // Jest/Vitest/Chai: expect(x).toBe(y), expect(x).not.toEqual(y), expect.soft(...)
  if (text === 'expect' || text === 'expectTypeOf') return true;
  if (text.startsWith('expect(') || text.startsWith('expect.') || text.startsWith('expectTypeOf(')) {
    return true;
  }
  if (text === 'should' || text.startsWith('should.') || text.startsWith('should(')) return true;
  if (text.startsWith('chai.')) return true;
  // node:test context: t.ok, t.is, t.throws, t.assert.strictEqual, ...
  if (/^t\.assert(\.[A-Za-z_$][\w$]*)*$/.test(text)) return true;
  if (/^t\.[A-Za-z_$][\w$]*$/.test(text)) {
    const member = text.slice(2);
    return T_ASSERTION_MEMBERS.has(member);
  }
  return false;
}

function hasAssertion(body: AstNode): boolean {
  let found = false;
  walk(body, (node) => {
    if (found) return false;
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function') ?? node.namedChildren[0];
      const text = collapseWhitespace(fn?.text ?? '');
      if (isAssertionCallee(text)) {
        found = true;
        return false;
      }
    }
    return true;
  });
  return found;
}

const phantomImport: Rule = {
  meta: {
    id: 'ts/phantom-import',
    title: 'Import is not a dependency',
    summary:
      'Finds imports of packages that package.json never declares (and, worse, that are not even installed). The most common way AI code fails to run anywhere but the machine it was written on.',
    severity: 'error',
    confidence: 'high',
    languages: ['typescript', 'tsx'],
    tags: ['dependencies', 'hallucination'],
  },
  run(ctx) {
    if (ctx.language === 'python') return [];
    const drafts: RuleDraft[] = [];
    if (!ctx.deps.node.hasPackageJson) return drafts;

    const { declared, installed, workspaces, aliases } = ctx.deps.node;

    for (const { node, specifier } of moduleSpecifiers(ctx.root)) {
      if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
      if (NODE_BUILTINS.has(specifier)) continue;
      if (specifier.startsWith('#')) continue;
      if (ASSET_SPECIFIER.test(specifier)) continue;
      if (VIRTUAL_SPECIFIER.test(specifier)) continue;
      if (matchesAlias(specifier, aliases)) continue;
      // `try { require('optional-dep') } catch {}` is the optional-dependency idiom.
      if (ancestorOfType(node, ['try_statement'])) continue;

      const pkg = packageRootOf(specifier);
      if (NODE_BUILTINS.has(pkg)) continue;
      if (matchesAlias(pkg, aliases)) continue;
      if (declared.has(pkg) || workspaces.has(pkg)) continue;
      if (ctx.deps.ignoredModules.has(pkg)) continue;

      const isInstalled = installed.has(pkg);
      drafts.push({
        message: isInstalled
          ? `\`${pkg}\` is imported but not listed in package.json`
          : `\`${pkg}\` is imported but is not a dependency and is not installed`,
        start: startOf(node),
        end: endOf(node),
        snippet: snippetOf(ctx, node),
        confidence: isInstalled || isTestPath(ctx.file) ? 'medium' : 'high',
        evidence: [
          `specifier: ${specifier}`,
          isInstalled ? `found in node_modules/${pkg}` : `not found in node_modules/${pkg}`,
          'not listed in dependencies, devDependencies, peerDependencies or optionalDependencies',
        ],
        help: isInstalled
          ? 'Add it to package.json so a fresh install reproduces your build.'
          : 'A package that is not installed cannot be run. Check the name on npm: this is the signature of a hallucinated package.',
      });
    }
    return drafts;
  },
};

const TEST_MODIFIERS = new Set([
  'only',
  'skip',
  'todo',
  'concurrent',
  'sequential',
  'each',
  'for',
  'fails',
  'failing',
  'serial',
  'runIf',
  'skipIf',
]);

/**
 * `test(...)` / `it(...)` and their modifiers (`test.only`, `test.each(...)`).
 * The root segment alone is not enough: `test.valid.forEach(...)` inside
 * ESLint's rule tester is a data loop, not a test.
 */
function isTestCall(fn: AstNode): boolean {
  let node = fn;
  if (node.type === 'call_expression') node = node.childForFieldName('function') ?? node;
  const text = collapseWhitespace(node.text);
  const root = text.split(/[.(]/)[0] ?? '';
  if (root !== 'test' && root !== 'it') return false;
  const modifiers = [...text.matchAll(/\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1] ?? '');
  return modifiers.every((name) => TEST_MODIFIERS.has(name));
}

const noopTest: Rule = {
  meta: {
    id: 'ts/noop-test',
    title: 'Test does not assert anything',
    summary: 'Finds `test()` / `it()` callbacks with an empty body or no assertion, so they pass regardless of the code.',
    severity: 'warning',
    confidence: 'high',
    languages: ['typescript', 'tsx'],
    tags: ['tests', 'theater'],
  },
  run(ctx) {
    if (ctx.language === 'python') return [];
    const drafts: RuleDraft[] = [];

    for (const call of descendantsOfType(ctx.root, ['call_expression'])) {
      const fn = call.childForFieldName('function');
      if (!fn || !isTestCall(fn)) continue;

      const args = call.childForFieldName('arguments');
      if (!args) continue;
      const callback = [...args.namedChildren]
        .reverse()
        .find((child) => child.type === 'arrow_function' || child.type === 'function_expression' || child.type === 'function');
      if (!callback) continue;
      const body = callback.childForFieldName('body');
      if (!body) continue;

      const label = args.namedChildren[0]?.type === 'string' ? truncate(args.namedChildren[0].text, 60) : undefined;

      if (body.type !== 'statement_block') {
        if (!hasAssertion(body)) {
          drafts.push({
            message: 'test makes no assertions',
            start: startOf(call),
            end: endOf(body),
            snippet: snippetOf(ctx, call),
            evidence: [`test: ${label ?? '(anonymous)'}`, 'the test body only calls code without checking a result'],
            help: 'Every test should be able to fail. Add an assertion that depends on the behaviour under test.',
          });
        }
        continue;
      }

      const statements = body.namedChildren.filter((child) => !isComment(child));

      if (statements.length === 0) {
        drafts.push({
          message: 'test has an empty body',
          start: startOf(call),
          end: endOf(body),
          snippet: snippetOf(ctx, call),
          evidence: [`test: ${label ?? '(anonymous)'}`],
          help: 'Add an assertion, or delete the test.',
        });
        continue;
      }
      if (!hasAssertion(body)) {
        drafts.push({
          message: 'test makes no assertions',
          start: startOf(call),
          end: endOf(body),
          snippet: snippetOf(ctx, call),
          evidence: [`test: ${label ?? '(anonymous)'}`, `statements: ${statements.length}`, 'no expect() / assert() found'],
          help: 'Every test should be able to fail. Add an assertion that depends on the behaviour under test.',
        });
      }
    }
    return drafts;
  },
};

const tautologicalAssert: Rule = {
  meta: {
    id: 'ts/tautological-assert',
    title: 'Assertion compares a value to itself',
    summary: 'Finds `expect(true).toBe(true)`, `expect(x).toEqual(x)` and similar assertions that cannot fail.',
    severity: 'warning',
    confidence: 'high',
    languages: ['typescript', 'tsx'],
    tags: ['tests', 'theater'],
  },
  run(ctx) {
    if (ctx.language === 'python') return [];
    const drafts: RuleDraft[] = [];

    for (const call of descendantsOfType(ctx.root, ['call_expression'])) {
      const fn = call.childForFieldName('function');
      if (!fn || fn.type !== 'member_expression') continue;
      const property = fn.childForFieldName('property')?.text;
      if (!property) continue;
      const object = fn.childForFieldName('object');
      const args = call.childForFieldName('arguments');
      const actual = args?.namedChildren[0]?.text;
      if (actual === undefined) continue;

      let expected: string | undefined;
      if (object?.type === 'call_expression' && collapseWhitespace(object.childForFieldName('function')?.text ?? '') === 'expect') {
        expected = object.childForFieldName('arguments')?.namedChildren[0]?.text;
      }

      const isSelf =
        expected !== undefined &&
        expected === actual &&
        ['toBe', 'toEqual', 'toStrictEqual'].includes(property);
      const isTruthyTrue = property === 'toBeTruthy' && expected === 'true';

      if (!isSelf && !isTruthyTrue) continue;
      drafts.push({
        message: `assertion compares a value to itself: \`${truncate(collapseWhitespace(call.text), 80)}\``,
        start: startOf(call),
        end: endOf(call),
        snippet: snippetOf(ctx, call),
        evidence: ['expected and actual expressions are identical'],
        help: 'Assert on the behaviour under test: a return value, a thrown error, or a call.',
      });
    }
    return drafts;
  },
};

function stubForm(body: AstNode): string | undefined {
  const statements = body.namedChildren.filter((child) => !isComment(child));
  if (statements.length === 0) return 'empty body';
  if (statements.length === 1 && statements[0]?.type === 'throw_statement') {
    if (/not\s*implemented|notimplemented|todo/i.test(statements[0].text)) return 'throws "not implemented"';
  }
  return undefined;
}

const NOOP_NAMES = /^(noop|no_?op|nop|ignore|identity|pass|doNothing|noopFn|noOpFn)$/i;

/** JSDoc that marks a deliberate abstract/no-op member. */
function hasAbstractDoc(ctx: RuleContext, node: AstNode): boolean {
  const start = node.startPosition.row + 1;
  for (let line = Math.max(1, start - 8); line < start; line += 1) {
    const text = ctx.lines[line - 1] ?? '';
    if (/@abstract|@virtual|@noop/i.test(text)) return true;
  }
  return false;
}

function declaredName(node: AstNode): string | undefined {
  const name = node.childForFieldName('name')?.text;
  return name;
}

const stubFunction: Rule = {
  meta: {
    id: 'ts/stub-function',
    title: 'Function body is a placeholder',
    summary:
      'Finds exported functions and class methods whose body is empty or only throws "not implemented". Common when a model writes the signature and forgets the implementation.',
    severity: 'warning',
    confidence: 'high',
    languages: ['typescript', 'tsx'],
    tags: ['stubs', 'completeness'],
  },
  run(ctx) {
    if (ctx.language === 'python') return [];
    if (isTestPath(ctx.file)) return [];
    const drafts: RuleDraft[] = [];

    for (const node of descendantsOfType(ctx.root, ['function_declaration', 'method_definition'])) {
      if (ancestorOfType(node, ['ambient_declaration'])) continue;
      if (node.children.some((child) => child.type === 'abstract')) continue;
      // Methods in object literals are often deliberate no-op dispatch entries.
      if (node.parent?.type === 'object') continue;
      const name = declaredName(node);
      if (name === 'constructor') continue;
      if (name !== undefined && NOOP_NAMES.test(name)) continue;
      if (hasAbstractDoc(ctx, node)) continue;
      const body = node.childForFieldName('body');
      if (!body || body.type !== 'statement_block') continue;
      const form = stubForm(body);
      if (!form) continue;

      drafts.push({
        message: `\`${name ?? '(anonymous)'}\` has a placeholder body (${form})`,
        start: startOf(node),
        end: endOf(body),
        snippet: snippetOf(ctx, node),
        // An empty body is a weak signal in JavaScript: callbacks and dispatch
        // tables legitimately do nothing. Only an explicit "not implemented"
        // throw is evidence of an abandoned implementation.
        confidence: form === 'empty body' ? 'medium' : 'high',
        evidence: [`body: ${form}`],
        help: 'Implement it, or throw an error with a message so callers fail loudly instead of silently doing nothing.',
      });
    }

    for (const node of descendantsOfType(ctx.root, ['arrow_function'])) {
      const body = node.childForFieldName('body');
      if (!body || body.type !== 'statement_block') continue;
      const form = stubForm(body);
      if (form !== 'throws "not implemented"') continue;
      drafts.push({
        message: 'arrow function has a placeholder body (throws "not implemented")',
        start: startOf(node),
        end: endOf(body),
        snippet: snippetOf(ctx, node),
        evidence: ['body: throws "not implemented"'],
        help: 'Implement it, or throw an error with a message so callers fail loudly.',
      });
    }
    return drafts;
  },
};

const swallowedException: Rule = {
  meta: {
    id: 'ts/swallowed-exception',
    title: 'Exception is swallowed silently',
    summary:
      'Finds `catch {}` blocks that discard the error. Confidence is medium by default: empty catch is idiomatic in JavaScript for best-effort cleanup.',
    severity: 'warning',
    confidence: 'medium',
    languages: ['typescript', 'tsx'],
    tags: ['errors', 'reliability'],
  },
  run(ctx) {
    if (ctx.language === 'python') return [];
    if (isTestPath(ctx.file)) return [];
    const drafts: RuleDraft[] = [];

    for (const clause of descendantsOfType(ctx.root, ['catch_clause'])) {
      const body = clause.namedChildren.filter((child) => child.type === 'statement_block').pop();
      if (!body) continue;
      const statements = body.namedChildren.filter((child) => !isComment(child));
      if (statements.length > 0) continue;
      const commented = hasCommentBetween(ctx, clause.startPosition.row + 1, body.endPosition.row + 1);

      drafts.push({
        message: commented ? '`catch` swallows the error (a comment explains why)' : '`catch` swallows the error silently',
        start: startOf(clause),
        end: endOf(body),
        snippet: snippetOf(ctx, clause),
        confidence: 'medium',
        evidence: [
          `handler: ${truncate(collapseWhitespace(clause.text.split(/\r?\n/)[0] ?? ''), 100)}`,
          ...(commented ? ['a comment explains the suppression'] : []),
        ],
        help: 'Log it, rethrow it, or add a comment explaining why it is safe to ignore.',
      });
    }
    return drafts;
  },
};

const deadBranch: Rule = {
  meta: {
    id: 'ts/dead-branch',
    title: 'Constant condition',
    summary: 'Finds `if (false)`, `while (false)` and `if (true)` branches that can never behave as written.',
    severity: 'warning',
    confidence: 'medium',
    languages: ['typescript', 'tsx'],
    tags: ['control-flow', 'dead-code'],
  },
  run(ctx) {
    if (ctx.language === 'python') return [];
    if (isTestPath(ctx.file)) return [];
    const drafts: RuleDraft[] = [];

    for (const node of descendantsOfType(ctx.root, ['if_statement', 'while_statement'])) {
      const condition = node.childForFieldName('condition');
      if (!condition) continue;
      let text = collapseWhitespace(condition.text);
      while (text.startsWith('(') && text.endsWith(')')) {
        text = text.slice(1, -1).trim();
      }
      const isFalse = text === 'false' || text === '0';
      const isTrue = text === 'true' || text === '1';
      if (!isFalse && !isTrue) continue;
      if (isTrue && node.type === 'while_statement') continue;

      drafts.push({
        message: isFalse
          ? `\`${node.type === 'while_statement' ? 'while' : 'if'} (${text})\` is dead code`
          : `\`if (${text})\` makes the else-branch unreachable`,
        start: startOf(node),
        end: endOf(condition),
        snippet: snippetOf(ctx, node),
        confidence: isFalse ? 'high' : 'medium',
        evidence: [`condition: ${text}`],
        help: 'Replace the constant with the flag or configuration value it is standing in for.',
      });
    }
    return drafts;
  },
};

const unreachable: Rule = {
  meta: {
    id: 'ts/unreachable',
    title: 'Statement after an unconditional exit',
    summary: 'Finds statements placed after `return`, `throw`, `break` or `continue` in the same block.',
    severity: 'error',
    confidence: 'high',
    languages: ['typescript', 'tsx'],
    tags: ['control-flow', 'dead-code'],
  },
  run(ctx) {
    if (ctx.language === 'python') return [];
    if (isTestPath(ctx.file)) return [];
    const drafts: RuleDraft[] = [];

    for (const block of descendantsOfType(ctx.root, ['statement_block'])) {
      const statements = block.namedChildren.filter((child) => !isComment(child));
      const index = statements.findIndex((statement) => TERMINATORS.has(statement.type));
      if (index === -1) continue;
      const terminator = statements[index];
      const firstUnreachable = statements[index + 1];
      if (!terminator || !firstUnreachable) continue;
      const count = statements.length - index - 1;
      const keyword = terminator.type.replace('_statement', '');

      drafts.push({
        message: `code after \`${keyword}\` is unreachable`,
        start: startOf(firstUnreachable),
        end: endOf(firstUnreachable),
        snippet: snippetOf(ctx, firstUnreachable),
        evidence: [`${count} statement(s) follow the \`${keyword}\` at line ${terminator.startPosition.row + 1}`],
        help: 'Delete the unreachable code, or move it before the exit if it was meant to run.',
      });
    }
    return drafts;
  },
};

export const typescriptRules: Rule[] = [
  phantomImport,
  noopTest,
  tautologicalAssert,
  stubFunction,
  swallowedException,
  deadBranch,
  unreachable,
];
