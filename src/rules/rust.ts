import type { AstNode } from '../ast.ts';
import type { Rule, RuleContext, RuleDraft } from '../types.ts';
import {
  descendantsOfType,
  endOf,
  hasCommentBetween,
  isComment,
  isTestPath,
  snippetOf,
  startOf,
  statementsOf,
  walk,
} from './helpers.ts';

const RUST_FUNCTIONS = new Set(['function_item']);
const RUST_TERMINATORS = new Set(['return_expression', 'break_expression', 'continue_expression']);
// Items declared in a block are not executed in source order; Rust hoists them
// and allows them after a return. They must not be reported as dead code.
const RUST_ITEMS = new Set([
  'function_item',
  'struct_item',
  'enum_item',
  'union_item',
  'trait_item',
  'impl_item',
  'mod_item',
  'use_declaration',
  'type_item',
  'const_item',
  'static_item',
  'attribute_item',
  'extern_crate_declaration',
  'macro_definition',
  'foreign_mod_item',
]);
const RUST_STD_ROOTS = new Set(['std', 'core', 'alloc', 'proc_macro', 'test']);
const RUST_LOCAL_ROOTS = new Set(['crate', 'self', 'super']);

function bodyOf(node: AstNode): AstNode | undefined {
  return node.childForFieldName('body') ?? undefined;
}

function functions(root: AstNode): AstNode[] {
  const found: AstNode[] = [];
  walk(root, (node) => {
    if (RUST_FUNCTIONS.has(node.type)) found.push(node);
  });
  return found;
}

export function isGeneratedRust(ctx: RuleContext): boolean {
  // A generated marker belongs in the file header, before the first item.
  // Scanning the whole source would let a normal code comment disable rules.
  const firstItem = ctx.root.namedChildren.find((node) =>
    [
      'use_declaration',
      'function_item',
      'struct_item',
      'enum_item',
      'union_item',
      'trait_item',
      'impl_item',
      'mod_item',
      'const_item',
      'static_item',
      'type_item',
      'extern_crate_declaration',
      'macro_definition',
      'foreign_mod_item',
    ].includes(node.type),
  );
  const header = firstItem ? ctx.source.slice(0, firstItem.startIndex) : ctx.source;
  return /^(?:\/\/\s*@generated\b|\/\/ Code generated .* DO NOT EDIT\.)/m.test(header);
}

function cfgHasPositiveTest(text: string): boolean {
  const cfg = /#\[\s*cfg\s*\(([\s\S]*)\)\]/.exec(text);
  if (!cfg?.[1]) return false;
  return cfgExprHasPositiveTest(cfg[1]);
}

function cfgExprHasPositiveTest(expr: string): boolean {
  const text = expr.trim();
  const call = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(text);
  if (call?.[1]) {
    const open = text.indexOf('(');
    let depth = 0;
    let close = -1;
    for (let index = open; index < text.length; index += 1) {
      if (text[index] === '(') depth += 1;
      else if (text[index] === ')') {
        depth -= 1;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }
    if (close < 0) return false;
    const name = call[1];
    if (name === 'not') return false;
    if (name !== 'all' && name !== 'any') return false;
    const inner = text.slice(open + 1, close);
    const args: string[] = [];
    let start = 0;
    let innerDepth = 0;
    let quote: string | undefined;
    for (let index = 0; index < inner.length; index += 1) {
      const ch = inner[index];
      if (quote) {
        if (ch === quote && inner[index - 1] !== '\\') quote = undefined;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '(') innerDepth += 1;
      else if (ch === ')') innerDepth -= 1;
      else if (ch === ',' && innerDepth === 0) {
        args.push(inner.slice(start, index));
        start = index + 1;
      }
    }
    args.push(inner.slice(start));
    return args.some((arg) => cfgExprHasPositiveTest(arg));
  }
  return text === 'test';
}

function hasTestCfg(node: AstNode): boolean {
  return previousAttributes(node).some((attribute) => cfgHasPositiveTest(attribute.text));
}

function previousAttributes(node: AstNode): AstNode[] {
  const parent = node.parent;
  if (!parent) return [];
  const siblings = parent.namedChildren;
  const index = siblings.findIndex(
    (sibling) => sibling.startIndex === node.startIndex && sibling.endIndex === node.endIndex,
  );
  if (index < 0) return [];
  const attributes: AstNode[] = [];
  for (let i = index - 1; i >= 0; i -= 1) {
    const sibling = siblings[i];
    if (!sibling) break;
    if (isComment(sibling)) continue;
    if (sibling.type !== 'attribute_item') break;
    attributes.push(sibling);
  }
  return attributes;
}

function hasAttribute(node: AstNode, pattern: RegExp): boolean {
  return previousAttributes(node).some((attribute) => pattern.test(attribute.text));
}

function isTestFunction(node: AstNode): boolean {
  return hasAttribute(node, /^#\[\s*(?:tokio::)?test\b/);
}

function hasTestContext(node: AstNode): boolean {
  let current: AstNode | null = node;
  while (current) {
    if (current.type === 'function_item' && (isTestFunction(current) || hasTestCfg(current))) {
      return true;
    }
    if (
      current.type === 'mod_item' &&
      (hasTestCfg(current) || hasAttribute(current, /^#\[\s*cfg\s*\(\s*test\s*\)/))
    ) {
      return true;
    }
    if ((current.type === 'impl_item' || current.type === 'trait_item') && hasTestCfg(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function pathsOfUse(node: AstNode): string[] {
  const raw = node.childForFieldName('argument')?.text ?? '';
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1);
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < inner.length; index += 1) {
      const ch = inner[index];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === ',' && depth === 0) {
        parts.push(inner.slice(start, index));
        start = index + 1;
      }
    }
    parts.push(inner.slice(start));
    return parts.flatMap((part) => pathsOfUseText(part));
  }
  return pathsOfUseText(raw);
}

function pathsOfUseText(raw: string): string[] {
  // Remove the alias before stripping whitespace: `serde as s` must become
  // `serde`, not `serdeass`. Comments inside grouped imports are also ignored.
  const withoutComments = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutAlias = withoutComments.replace(/\s+as\s+.*$/, '');
  const text = withoutAlias.replace(/\s+/g, '').replace(/^::/, '').replace(/^r#/, '');
  if (!text) return [];
  if (text.startsWith('{') && text.endsWith('}')) {
    const inner = text.slice(1, -1);
    return inner.split(',').flatMap((part) => pathsOfUseText(part));
  }
  const root = text.split('::')[0] ?? '';
  return root ? [root.replace(/^r#/, '')] : [];
}

function normalizedCrate(name: string): string {
  return name.replace(/-/g, '_');
}

function isDeclaredRustPath(
  path: string,
  ctx: RuleContext,
  inlineModules: ReadonlySet<string> = new Set(),
): boolean {
  const clean = path.replace(/^::/, '');
  const first = normalizedCrate(clean.split('::')[0] ?? '');
  if (!first) return true;
  // Rust convention: crate and module names start lowercase; uppercase roots
  // are local types, enums or constants, not crates.
  if (/^[A-Z]/.test(first)) return true;
  if (RUST_STD_ROOTS.has(first) || RUST_LOCAL_ROOTS.has(first)) return true;
  if (inlineModules.has(first)) return true;
  if (ctx.deps.rust.manifests.length === 0) return true;
  const ownCrate = ctx.deps.rust.crateName ? normalizedCrate(ctx.deps.rust.crateName) : undefined;
  const library = ctx.deps.rust.libraryName
    ? normalizedCrate(ctx.deps.rust.libraryName)
    : undefined;
  if (ownCrate === first || library === first) return true;
  if (
    ctx.deps.rust.dependencies.has(first) ||
    ctx.deps.rust.localModules.has(first)
  ) {
    return true;
  }
  for (const ignored of ctx.deps.ignoredModules) {
    if (first === normalizedCrate(ignored)) return true;
  }
  return false;
}

function isStubMacro(node: AstNode): boolean {
  const text = node.text.trim();
  return (
    /^(?:todo|unimplemented)!\(\)$/i.test(text) ||
    /^panic!\(\s*"(?:not implemented|unimplemented|todo)"\s*\)$/i.test(text)
  );
}

function isTerminator(statement: AstNode): boolean {
  if (statement.type === 'expression_statement') {
    const child = statement.namedChildren[0];
    return child !== undefined && RUST_TERMINATORS.has(child.type);
  }
  return RUST_TERMINATORS.has(statement.type);
}

function rustPhantomImportRule(): Rule {
  return {
    meta: {
      id: 'rs/phantom-import',
      title: 'Unresolved Rust import',
      summary: 'Finds a Rust use path that is neither std/core/alloc, a Cargo dependency, nor a local module.',
      severity: 'error',
      confidence: 'medium',
      languages: ['rust'],
      tags: ['imports', 'dependencies'],
    },
    run(ctx) {
      if (isGeneratedRust(ctx) || isTestPath(ctx.file)) return [];
      if (ctx.deps.rust.manifests.length === 0) return [];
      const drafts: RuleDraft[] = [];
      const seen = new Set<string>();
      const inlineModules = new Set(
        descendantsOfType(ctx.root, ['mod_item'])
          .map((node) => node.childForFieldName('name')?.text)
          .filter((name): name is string => Boolean(name))
          .map((name) => normalizedCrate(name)),
      );
      for (const node of descendantsOfType(ctx.root, ['use_declaration'])) {
        for (const path of pathsOfUse(node)) {
          if (!path || seen.has(path)) continue;
          seen.add(path);
          if (isDeclaredRustPath(path, ctx, inlineModules)) continue;
          drafts.push({
            message: `\`${path}\` is used but not provided by std, a Cargo dependency, or a local module`,
            start: startOf(node),
            end: endOf(node),
            snippet: snippetOf(ctx, node),
            evidence: ['no matching dependency name in Cargo.toml and no local module'],
            help: 'Add the crate to Cargo.toml, remove the use, or add the crate name to ignoreModules.',
          });
        }
      }
      return drafts;
    },
  };
}

function rustNoopTestRule(): Rule {
  return {
    meta: {
      id: 'rs/noop-test',
      title: 'Rust test without a failure path',
      summary: 'Finds a #[test] function with an empty body and no explanatory comment.',
      severity: 'warning',
      confidence: 'high',
      languages: ['rust'],
      tags: ['tests'],
    },
    run(ctx) {
      if (isGeneratedRust(ctx)) return [];
      const drafts: RuleDraft[] = [];
      for (const fn of functions(ctx.root)) {
        if (!isTestFunction(fn)) continue;
        if (hasAttribute(fn, /^#\[\s*(?:ignore|should_panic)\b/)) continue;
        const body = bodyOf(fn);
        if (!body || statementsOf(body).length > 0) continue;
        if (hasCommentBetween(ctx, Math.max(1, startOf(fn).line - 5), endOf(fn).line)) continue;
        drafts.push({
          message: `test \`${fn.childForFieldName('name')?.text ?? 'test'}\` has an empty body`,
          start: startOf(fn),
          end: endOf(fn),
          snippet: snippetOf(ctx, fn),
          evidence: ['the #[test] function body is empty'],
          help: 'Add an assertion, or annotate the test with #[ignore] and a reason if it is intentionally disabled.',
        });
      }
      return drafts;
    },
  };
}

function rustUnreachableRule(): Rule {
  return {
    meta: {
      id: 'rs/unreachable',
      title: 'Unreachable Rust code',
      summary: 'Finds statements after return, break or continue in the same block.',
      severity: 'error',
      confidence: 'high',
      languages: ['rust'],
      tags: ['dead-code'],
    },
    run(ctx) {
      if (isGeneratedRust(ctx) || isTestPath(ctx.file)) return [];
      const drafts: RuleDraft[] = [];
      for (const block of descendantsOfType(ctx.root, ['block'])) {
        if (hasTestContext(block)) continue;
        let dead = false;
        for (const statement of statementsOf(block)) {
          if (dead) {
            if (RUST_ITEMS.has(statement.type) || statement.type === 'empty_statement') continue;
            drafts.push({
              message: 'code after a terminating expression is unreachable',
              start: startOf(statement),
              end: endOf(statement),
              snippet: snippetOf(ctx, statement),
              evidence: ['the preceding expression always exits this block'],
              help: 'Delete the unreachable code, or move it before the exit if it was meant to run.',
            });
            continue;
          }
          if (isTerminator(statement)) dead = true;
        }
      }
      return drafts;
    },
  };
}

function rustStubBodyRule(): Rule {
  return {
    meta: {
      id: 'rs/stub-body',
      title: 'Rust stub placeholder',
      summary: 'Finds a function whose body is only todo!(), unimplemented!() or a not-implemented panic.',
      severity: 'warning',
      confidence: 'high',
      languages: ['rust'],
      tags: ['stubs'],
    },
    run(ctx) {
      if (isGeneratedRust(ctx) || isTestPath(ctx.file)) return [];
      // `sys/` contains platform backends that intentionally expose
      // unimplemented operations on unsupported targets.
      if (/(?:^|\/)sys\//.test(ctx.file)) return [];
      const drafts: RuleDraft[] = [];
      for (const fn of functions(ctx.root)) {
        if (isTestFunction(fn) || hasTestContext(fn)) continue;
        const body = bodyOf(fn);
        if (!body) continue;
        const bodyStatements = statementsOf(body);
        if (bodyStatements.length !== 1) continue;
        const statement = bodyStatements[0];
        if (!statement) continue;
        const macro =
          statement.type === 'macro_invocation'
            ? statement
            : statement.type === 'expression_statement'
              ? statement.namedChildren[0]
              : undefined;
        if (!macro || macro.type !== 'macro_invocation' || !isStubMacro(macro)) continue;
        drafts.push({
          message: 'function is a stub that panics instead of returning a value',
          start: startOf(fn),
          end: endOf(fn),
          snippet: snippetOf(ctx, fn),
          evidence: ['the entire body is a todo/unimplemented placeholder'],
          help: 'Implement the function, or return an explicit Result error so callers fail deliberately.',
        });
      }
      return drafts;
    },
  };
}

function rustSwallowedErrorRule(): Rule {
  return {
    meta: {
      id: 'rs/swallowed-error',
      title: 'Swallowed Rust error',
      summary: 'Finds an empty `if let Err(_) = ...` block that silently ignores a Result error.',
      severity: 'warning',
      confidence: 'high',
      languages: ['rust'],
      tags: ['errors'],
    },
    run(ctx) {
      if (isGeneratedRust(ctx) || isTestPath(ctx.file)) return [];
      const drafts: RuleDraft[] = [];
      for (const node of descendantsOfType(ctx.root, ['if_expression'])) {
        if (hasTestContext(node)) continue;
        const condition = node.childForFieldName('condition');
        const consequence = node.childForFieldName('consequence');
        if (!condition || !consequence) continue;
        if (!/^let\s+Err\s*\(/.test(condition.text)) continue;
        if (statementsOf(consequence).length > 0) continue;
        if (hasCommentBetween(ctx, startOf(consequence).line, endOf(consequence).line)) continue;
        drafts.push({
          message: 'an Err(_) result is matched but the failure branch is empty',
          start: startOf(node),
          end: endOf(node),
          snippet: snippetOf(ctx, node),
          evidence: ['the `if let Err(_)` block contains no statement'],
          help: 'Handle the error with ?, log it, or propagate it; do not silently ignore it.',
        });
      }
      return drafts;
    },
  };
}

export const rustRules: readonly Rule[] = [
  rustPhantomImportRule(),
  rustNoopTestRule(),
  rustUnreachableRule(),
  rustStubBodyRule(),
  rustSwallowedErrorRule(),
];
