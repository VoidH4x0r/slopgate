import type { AstNode } from '../ast.ts';
import { isGoStdlib } from '../data/go-stdlib.ts';
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

const GO_FUNCTIONS = new Set(['function_declaration', 'method_declaration']);
const GO_TERMINATORS = new Set(['return_statement', 'break_statement', 'continue_statement']);

function bodyOf(node: AstNode): AstNode | undefined {
  return node.childForFieldName('body') ?? undefined;
}

function functions(root: AstNode): AstNode[] {
  const found: AstNode[] = [];
  walk(root, (node) => {
    if (GO_FUNCTIONS.has(node.type)) found.push(node);
  });
  return found;
}

export function goHeader(ctx: RuleContext): string {
  const packageClause = ctx.root.namedChildren.find((node) => node.type === 'package_clause');
  return packageClause ? ctx.source.slice(0, packageClause.startIndex) : ctx.source;
}

export function isGeneratedGo(ctx: RuleContext): boolean {
  // The canonical marker must precede the package clause; scanning the whole
  // source would let a normal code comment disable high rules.
  return /^\/\/ Code generated .* DO NOT EDIT\.$/m.test(goHeader(ctx));
}

export function hasBuildConstraint(ctx: RuleContext): boolean {
  const header = goHeader(ctx);
  if (/^\/\/go:build\s/m.test(header) || /^\/\/ \+build\s/m.test(header)) return true;
  return /_(?:aix|android|darwin|dragonfly|freebsd|illumos|ios|js|linux|netbsd|openbsd|plan9|solaris|wasip1|windows|amd64|386|arm|arm64|loong64|mips|mips64|mips64le|mipsle|ppc64|ppc64le|riscv64|s390x|wasm)\.go$/.test(
    ctx.file,
  );
}

function isStubPanic(call: AstNode): boolean {
  return /^panic\(\s*["`](?:not implemented|unimplemented|todo)["`]\s*\)$/i.test(call.text.trim());
}

function importPath(node: AstNode): string {
  return node.text.replace(/^["`]|["`]$/g, '');
}

function importSpecs(root: AstNode): AstNode[] {
  return descendantsOfType(root, ['import_spec']);
}

function isDeclaredGo(importName: string, ctx: RuleContext): boolean {
  if (isGoStdlib(importName)) return true;
  const deps = ctx.deps.go;
  if (deps.manifests.length === 0) return true;
  // The Go standard library imports its own internal packages; a user module
  // with module path `std` is not a realistic target for this rule.
  if (deps.module === 'std' && (importName === 'internal' || importName.startsWith('internal/'))) {
    return true;
  }
  const module = deps.module;
  if (module && (importName === module || importName.startsWith(`${module}/`))) return true;
  for (const required of deps.requires) {
    if (importName === required || importName.startsWith(`${required}/`)) return true;
  }
  for (const ignored of ctx.deps.ignoredModules) {
    if (
      importName === ignored ||
      importName.startsWith(`${ignored}/`) ||
      importName.split('/')[0] === ignored
    ) {
      return true;
    }
  }
  return false;
}

function callName(node: AstNode): string {
  return node.text.split('(')[0]?.replace(/\s+/g, '') ?? '';
}

function isTestFunction(node: AstNode): boolean {
  if (node.type !== 'function_declaration') return false;
  const name = node.childForFieldName('name')?.text ?? '';
  // go test discovers TestX where X is not lowercase (and not TestMain).
  return /^Test(?:[^a-z]|$)/.test(name) && name !== 'TestMain';
}

function goPhantomImportRule(): Rule {
  return {
    meta: {
      id: 'go/phantom-import',
      title: 'Unresolved Go import',
      summary: 'Finds a Go import that is neither standard-library, local to the module, nor required in go.mod.',
      severity: 'error',
      confidence: 'high',
      languages: ['go'],
      tags: ['imports', 'dependencies'],
    },
    run(ctx) {
      if (isGeneratedGo(ctx) || isTestPath(ctx.classificationFile)) return [];
      if (ctx.deps.go.manifests.length === 0) return [];
      const drafts: RuleDraft[] = [];
      const seen = new Set<string>();
      for (const spec of importSpecs(ctx.root)) {
        const pathNode = spec.childForFieldName('path');
        if (!pathNode) continue;
        const name = importPath(pathNode);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        if (isDeclaredGo(name, ctx)) continue;
        drafts.push({
          message: `\`${name}\` is imported but not provided by the standard library, the module, or go.mod`,
          start: startOf(spec),
          end: endOf(spec),
          snippet: snippetOf(ctx, spec),
          evidence: ['no matching module path in go.mod and no standard-library root'],
          help: 'Add the module to go.mod, remove the import, or add the import root to ignoreModules.',
        });
      }
      return drafts;
    },
  };
}

function goUnreachableRule(): Rule {
  return {
    meta: {
      id: 'go/unreachable',
      title: 'Unreachable Go code',
      summary: 'Finds statements after return, break or continue in the same block.',
      severity: 'error',
      confidence: 'high',
      languages: ['go'],
      tags: ['dead-code'],
    },
    run(ctx) {
      if (isGeneratedGo(ctx) || isTestPath(ctx.classificationFile) || hasBuildConstraint(ctx)) return [];
      const drafts: RuleDraft[] = [];
      const checkStatements = (statements: AstNode[], owner: AstNode): void => {
        // Labels and goto make a linear "statement after return" analysis
        // unsound: the label may be the target of a jump from earlier code.
        if (descendantsOfType(owner, ['goto_statement', 'labeled_statement']).length > 0) return;
        let dead = false;
        for (const statement of statements) {
          if (dead) {
            if (statement.type === 'empty_statement') continue;
            drafts.push({
              message: 'code after a terminating statement is unreachable',
              start: startOf(statement),
              end: endOf(statement),
              snippet: snippetOf(ctx, statement),
              evidence: ['the preceding statement always exits this block'],
              help: 'Delete the unreachable code, or move it before the exit if it was meant to run.',
            });
            continue;
          }
          if (GO_TERMINATORS.has(statement.type)) dead = true;
        }
      };
      for (const block of descendantsOfType(ctx.root, ['block'])) {
        checkStatements(statementsOf(block), block);
      }
      for (const caseNode of descendantsOfType(ctx.root, [
        'expression_case',
        'communication_case',
        'default_case',
        'type_case',
      ])) {
        checkStatements(statementsOf(caseNode), caseNode);
      }
      return drafts;
    },
  };
}

function goStubBodyRule(): Rule {
  return {
    meta: {
      id: 'go/stub-body',
      title: 'Go stub placeholder',
      summary: 'Finds a function or method whose body is only a not-implemented panic.',
      severity: 'warning',
      confidence: 'high',
      languages: ['go'],
      tags: ['stubs'],
    },
    run(ctx) {
      if (isGeneratedGo(ctx) || isTestPath(ctx.classificationFile)) return [];
      if (hasBuildConstraint(ctx)) return [];
      const drafts: RuleDraft[] = [];
      for (const fn of functions(ctx.root)) {
        const body = bodyOf(fn);
        if (!body) continue;
        const statements = statementsOf(body);
        if (statements.length !== 1) continue;
        const statement = statements[0];
        if (!statement || statement.type !== 'expression_statement') continue;
        const call = statement.namedChildren[0];
        if (!call || call.type !== 'call_expression' || callName(call) !== 'panic') continue;
        if (!isStubPanic(call)) continue;
        drafts.push({
          message: 'function is a stub that panics instead of returning a value',
          start: startOf(fn),
          end: endOf(fn),
          snippet: snippetOf(ctx, fn),
          evidence: ['the entire body is a not-implemented panic'],
          help: 'Implement the function, or return an explicit error so callers fail deliberately.',
        });
      }
      return drafts;
    },
  };
}

function goNoopTestRule(): Rule {
  return {
    meta: {
      id: 'go/noop-test',
      title: 'Go test without a failure path',
      summary: 'Finds an empty Test function in a _test.go file with no explanatory comment.',
      severity: 'warning',
      confidence: 'high',
      languages: ['go'],
      tags: ['tests'],
    },
    run(ctx) {
      if (!ctx.file.endsWith('_test.go') || isGeneratedGo(ctx)) return [];
      const drafts: RuleDraft[] = [];
      for (const fn of functions(ctx.root)) {
        if (!isTestFunction(fn)) continue;
        const body = bodyOf(fn);
        if (!body) continue;
        // A non-empty test is doing something, even if it delegates the
        // assertion to a helper; an empty test with an explanatory comment is
        // usually a compile/init test.
        if (statementsOf(body).length > 0) continue;
        if (
          hasCommentBetween(
            ctx,
            Math.max(1, startOf(fn).line - 5),
            endOf(fn).line,
          )
        ) {
          continue;
        }
        drafts.push({
          message: `test \`${fn.childForFieldName('name')?.text ?? 'Test'}\` has no assertion, failure or skip`,
          start: startOf(fn),
          end: endOf(fn),
          snippet: snippetOf(ctx, fn),
          evidence: ['the test body is empty'],
          help: 'Add an assertion that can fail, or call t.Skip with a reason if the test is intentionally disabled.',
        });
      }
      return drafts;
    },
  };
}

function goSwallowedErrorRule(): Rule {
  return {
    meta: {
      id: 'go/swallowed-error',
      title: 'Swallowed Go error',
      summary: 'Finds an empty `if err != nil` block that silently ignores a returned error.',
      severity: 'warning',
      confidence: 'high',
      languages: ['go'],
      tags: ['errors'],
    },
    run(ctx) {
      if (isGeneratedGo(ctx) || isTestPath(ctx.classificationFile)) return [];
      const drafts: RuleDraft[] = [];
      for (const node of descendantsOfType(ctx.root, ['if_statement'])) {
        const condition = node.childForFieldName('condition');
        const consequence = node.childForFieldName('consequence');
        if (!condition || !consequence) continue;
        const cleaned = condition.text
          .trim()
          .replace(/^\(+/, '')
          .replace(/\)+$/, '')
          .trim();
        const checked = cleaned.split(';').at(-1)?.trim() ?? cleaned;
        const match = /^\s*([A-Za-z_]\w*)\s*!=\s*nil\s*$/.exec(checked);
        if (!match?.[1] || !/^(?:err|.*Err)$/.test(match[1])) continue;
        if (statementsOf(consequence).length > 0) continue;
        if (hasCommentBetween(ctx, startOf(consequence).line, endOf(consequence).line)) continue;
        drafts.push({
          message: `error \`${match[1]}\` is checked but the failure branch is empty`,
          start: startOf(node),
          end: endOf(node),
          snippet: snippetOf(ctx, node),
          evidence: ['the `if err != nil` block contains no statement'],
          help: 'Return the error, log it with context, or handle it explicitly; do not ignore it.',
        });
      }
      return drafts;
    },
  };
}

export const goRules: readonly Rule[] = [
  goPhantomImportRule(),
  goNoopTestRule(),
  goUnreachableRule(),
  goStubBodyRule(),
  goSwallowedErrorRule(),
];
