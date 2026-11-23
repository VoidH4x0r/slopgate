import type { AstNode } from '../ast.ts';
import { normalizePythonName } from '../deps.ts';
import {
  DISTRIBUTION_ALIASES,
  IMPLICIT_MODULES,
  IMPORT_TO_DISTRIBUTION,
  NAMESPACE_PREFIXES,
  PYTHON_STDLIB,
} from '../data/python-stdlib.ts';
import type { CommentRange, Confidence, Rule, RuleContext, RuleDraft } from '../types.ts';
import {
  ancestorOfType,
  collapseWhitespace,
  descendantsOfType,
  endOf,
  hasCommentBetween,
  hasDocstring,
  docstringOf,
  insideCleanupFunction,
  insideMainGuard,
  isComment,
  isNoopModulePath,
  isStubFile,
  isTestPath,
  looksLikeTestModule,
  moduleDocstring,
  snippetOf,
  startOf,
  statementsOf,
  truncate,
  walk,
} from './helpers.ts';
import { statementDeletionEdits } from './fixes.ts';

const TERMINATORS = new Set([
  'return_statement',
  'raise_statement',
  'break_statement',
  'continue_statement',
]);

function pythonImports(root: AstNode): Array<{ node: AstNode; module: string; root: string }> {
  const imports: Array<{ node: AstNode; module: string; root: string }> = [];
  for (const node of descendantsOfType(root, ['import_statement', 'import_from_statement'])) {
    if (node.type === 'import_statement') {
      for (const child of node.namedChildren) {
        if (isComment(child)) continue;
        const target = child.type === 'aliased_import' ? child.childForFieldName('name') : child;
        const full = collapseWhitespace(target?.text ?? '');
        const first = full.split('.')[0];
        if (first) imports.push({ node, module: full, root: first });
      }
      continue;
    }
    // `from .x import y` and `from . import y` are local by construction.
    if (node.namedChildren.some((child) => child.type === 'relative_import')) continue;
    const moduleNode = node.namedChildren.find((child) => child.type === 'dotted_name');
    const full = collapseWhitespace(moduleNode?.text ?? '');
    const first = full.split('.')[0];
    if (first) imports.push({ node, module: full, root: first });
  }
  return imports;
}

/** `try: import ujson except ImportError: ...` is an optional dependency. */
function isOptionalImport(node: AstNode): boolean {
  const tryNode = ancestorOfType(node, ['try_statement']);
  if (!tryNode) return false;
  const body = tryNode.childForFieldName('body');
  if (!body || node.startIndex < body.startIndex || node.startIndex >= body.endIndex) return false;
  return descendantsOfType(tryNode, ['except_clause', 'except_group_clause']).some((clause) => {
    const head = (clause.text.split(':')[0] ?? '').replace(/\s+as\s+\w+\s*$/, '').trim();
    return /^except\*?(?:\s+)?[\s\S]*?\b(?:ImportError|ModuleNotFoundError)\b/.test(head);
  });
}

const DISTRIBUTION_PREFIXES = Object.keys(IMPORT_TO_DISTRIBUTION).sort(
  (a, b) => b.length - a.length,
);

/** Longest dotted import prefix that has an explicit distribution mapping. */
function distributionFor(module: string): string | undefined {
  for (const prefix of DISTRIBUTION_PREFIXES) {
    if (module === prefix || module.startsWith(`${prefix}.`)) {
      return IMPORT_TO_DISTRIBUTION[prefix];
    }
  }
  return undefined;
}

function isDeclaredPython(module: string, ctx: RuleContext): boolean {
  const deps = ctx.deps.python;
  const parts = module.split('.');
  // A manifest declares distributions, but same-name packages (`requests`)
  // and dotted namespace packages (`google.protobuf`) both appear here.
  for (let index = parts.length; index > 0; index -= 1) {
    const candidate = parts.slice(0, index).join('.');
    if (deps.declared.has(normalizePythonName(candidate))) return true;
  }
  const distribution = distributionFor(module);
  if (distribution && deps.declared.has(normalizePythonName(distribution))) return true;
  const root = parts[0] ?? module;
  for (const alias of DISTRIBUTION_ALIASES[root] ?? []) {
    if (deps.declared.has(normalizePythonName(alias))) return true;
  }
  if (NAMESPACE_PREFIXES.has(root)) {
    const prefix = `${normalizePythonName(root)}-`;
    for (const declared of deps.declared) {
      if (declared.startsWith(prefix)) return true;
    }
  }
  return false;
}

function testFunctionName(fn: AstNode): string | undefined {
  const name = fn.childForFieldName('name')?.text;
  if (!name) return undefined;
  if (name.startsWith('test_') || /^test[A-Z0-9]/.test(name)) return name;
  return undefined;
}

const ASSERTION_CALLEE =
  /(^|\.)(assert\w*|raises|warns|warns_once|deprecated_call|expect|expects|should\w*|fail|check|verify|match_snapshot)$/;

function hasAssertion(body: AstNode): boolean {
  let found = false;
  walk(body, (node) => {
    if (found) return false;
    if (node !== body && (node.type === 'function_definition' || node.type === 'lambda')) return false;
    if (node.type === 'assert_statement') {
      found = true;
      return false;
    }
    if (node.type === 'call') {
      const fnText = collapseWhitespace(node.childForFieldName('function')?.text ?? '');
      const last = fnText.split('.').pop() ?? '';
      if (ASSERTION_CALLEE.test(last)) {
        found = true;
        return false;
      }
    }
    return true;
  });
  return found;
}

function bodyCallsSelf(body: AstNode): boolean {
  let found = false;
  walk(body, (node) => {
    if (found) return false;
    if (node.type === 'call') {
      const fnText = collapseWhitespace(node.childForFieldName('function')?.text ?? '');
      if (/^(self|cls)\./.test(fnText)) {
        found = true;
        return false;
      }
    }
    return true;
  });
  return found;
}

/** Lightweight name-to-node index; assertion checks happen on demand. */
function localFunctionDefinitions(functions: readonly AstNode[]): Map<string, AstNode> {
  const definitions = new Map<string, AstNode>();
  for (const fn of functions) {
    if (fn.parent?.type === 'class_definition') continue;
    const name = fn.childForFieldName('name')?.text;
    if (!name || testFunctionName(fn)) continue;
    definitions.set(name, fn);
  }
  return definitions;
}

/** Name of the bare local call in the test's last statement, if any. */
function lastLocalCallName(statements: readonly AstNode[]): string | undefined {
  const last = statements[statements.length - 1];
  if (!last) return undefined;
  const call =
    last.type === 'expression_statement' || last.type === 'return_statement'
      ? last.namedChildren[0]
      : undefined;
  if (call?.type !== 'call') return undefined;
  const name = collapseWhitespace(call.childForFieldName('function')?.text ?? '');
  return /^[A-Za-z_]\w*$/.test(name) ? name : undefined;
}

/**
 * Only check the helper the last statement actually calls. The definition map
 * is built on first hit and each helper's assertion result is cached, so a
 * test-heavy file does not run `hasAssertion` over every function.
 */
function delegatesToLocalHelper(
  statements: readonly AstNode[],
  definitions: () => ReadonlyMap<string, AstNode>,
  assertionCache: Map<string, boolean>,
): string | undefined {
  const name = lastLocalCallName(statements);
  if (!name) return undefined;
  const helper = definitions().get(name);
  if (!helper) return undefined;
  let asserts = assertionCache.get(name);
  if (asserts === undefined) {
    const body = helper.childForFieldName('body');
    asserts = body !== null && hasAssertion(body);
    assertionCache.set(name, asserts);
  }
  return asserts ? name : undefined;
}

function placeholderForm(block: AstNode): string | undefined {
  const statements = statementsOf(block);
  const afterDocstring =
    statements[0]?.type === 'expression_statement' &&
    statements[0].namedChildren[0]?.type === 'string'
      ? statements.slice(1)
      : statements;
  if (afterDocstring.length !== 1) return undefined;
  const only = afterDocstring[0];
  if (!only) return undefined;

  if (only.type === 'pass_statement') return 'pass';
  if (only.type === 'expression_statement') {
    const text = collapseWhitespace(only.text);
    if (text === '...') return '...';
    return undefined;
  }
  if (only.type === 'return_statement') {
    const text = collapseWhitespace(only.text);
    if (text === 'return' || text === 'return None') return text;
    return undefined;
  }
  if (only.type === 'raise_statement' && /NotImplementedError/.test(only.text)) {
    return 'raise NotImplementedError';
  }
  return undefined;
}

const NEVER_STUBS = new Set([
  '__init__',
  '__new__',
  '__post_init__',
  '__enter__',
  '__exit__',
  'setUp',
  'tearDown',
  'setUpClass',
  'tearDownClass',
]);

function isAbstractMember(fn: AstNode): boolean {
  const decorated = fn.parent;
  if (decorated && decorated.type === 'decorated_definition') {
    const decorators = decorated.namedChildren
      .filter((child) => child.type === 'decorator')
      .map((child) => child.text);
    if (decorators.some((text) => /abstractmethod|abstractproperty|overload|override/.test(text))) {
      return true;
    }
  }
  const cls = ancestorOfType(fn, ['class_definition']);
  if (cls) {
    const bases = cls.childForFieldName('superclasses')?.text ?? '';
    if (/Protocol|ABC|ABCMeta/.test(bases)) return true;
  }
  const ifNode = ancestorOfType(fn, ['if_statement']);
  if (ifNode) {
    const condition = ifNode.childForFieldName('condition')?.text ?? '';
    if (condition.includes('TYPE_CHECKING')) return true;
  }
  return false;
}

function insideAbstractMethod(node: AstNode): boolean {
  const fn = ancestorOfType(node, ['function_definition']);
  if (!fn) return false;
  const parent = fn.parent;
  if (parent && parent.type === 'decorated_definition') {
    return parent.namedChildren.some((child) => child.type === 'decorator' && /abstractmethod/.test(child.text));
  }
  return false;
}

/** Platform/version guards make the import conditional on the host. */
function insideTypeChecking(node: AstNode): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === 'if_statement') {
      const condition = current.childForFieldName('condition')?.text ?? '';
      if (/TYPE_CHECKING/.test(condition)) return true;
    }
    current = current.parent;
  }
  return false;
}

function insidePlatformGuard(node: AstNode): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === 'if_statement') {
      const condition = current.childForFieldName('condition')?.text ?? '';
      if (
        /sys\.platform|os\.name|platform\.system\s*\(|sys\.version_info|platform\.python_version\s*\(|six\.PY2|\bPY2\b/.test(
          condition,
        )
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

const phantomImport: Rule = {
  meta: {
    id: 'py/phantom-import',
    title: 'Import is neither declared nor present',
    summary:
      'Adds an import that no manifest declares and no file in the repository provides. The classic signature of a package the model invented.',
    severity: 'error',
    confidence: 'high',
    languages: ['python'],
    tags: ['dependencies', 'hallucination'],
  },
  run(ctx) {
    if (ctx.language !== 'python') return [];
    const drafts: RuleDraft[] = [];
    const manifests = ctx.deps.python.manifests;

    for (const { node, module, root } of pythonImports(ctx.root)) {
      if (PYTHON_STDLIB.has(root)) continue;
      if (IMPLICIT_MODULES.has(root)) continue;
      if (ctx.deps.ignoredModules.has(root) || ctx.deps.ignoredModules.has(module)) continue;
      // Private C-extension modules (`_socket`, `_decimal`, `_winapi`, ...) are
      // builtins; no project declares them in a manifest.
      if (root.startsWith('_')) continue;
      if (isDeclaredPython(module, ctx)) continue;
      if (ctx.deps.python.localModules.has(root)) continue;
      if (isOptionalImport(node)) continue;
      if (insideTypeChecking(node) || insidePlatformGuard(node)) continue;

      drafts.push({
        message: `\`${module}\` is imported but not declared in any manifest and not present in this repository`,
        start: startOf(node),
        end: endOf(node),
        snippet: snippetOf(ctx, node),
        // Test suites monkey-patch sys.path; keep the fact but do not fail CI.
        ...(isTestPath(ctx.classificationFile) ? { confidence: 'medium' as const } : {}),
        evidence: [
          `import: ${truncate(node.text, 100)}`,
          manifests.length > 0
            ? `manifests checked: ${manifests.join(', ')}`
            : 'no Python dependency manifest found (pyproject.toml, requirements*.txt, setup.py, Pipfile)',
        ],
        help:
          'Add it to your manifest, remove the import, or wrap it in try/except ImportError if it is optional.',
      });
    }
    return drafts;
  },
};

const noopTest: Rule = {
  meta: {
    id: 'py/noop-test',
    title: 'Test does not assert anything',
    summary:
      'Finds `test_*` functions whose body has no assertion, no `pytest.raises`, and no mock verification. They pass no matter what the code does.',
    severity: 'warning',
    confidence: 'high',
    languages: ['python'],
    tags: ['tests', 'theater'],
  },
  run(ctx) {
    if (ctx.language !== 'python') return [];
    if (isStubFile(ctx.classificationFile)) return [];
    const drafts: RuleDraft[] = [];
    // A test-dense file may have thousands of assertion-free tests. Reuse the
    // function list the rule already collected; build the name index once, and
    // only assert-check the helper actually called.
    const functions = descendantsOfType(ctx.root, ['function_definition']);
    let definitionIndex: Map<string, AstNode> | undefined;
    const definitions = (): Map<string, AstNode> => {
      definitionIndex ??= localFunctionDefinitions(functions);
      return definitionIndex;
    };
    const helperAssertions = new Map<string, boolean>();

    for (const fn of functions) {
      const name = testFunctionName(fn);
      if (!name) continue;
      if (insideMainGuard(fn)) continue;
      const inClass = ancestorOfType(fn, ['class_definition']) !== undefined;
      // `test_*` helpers exist in test-support tooling; only trust real test
      // modules, or methods of a test class.
      if (!looksLikeTestModule(ctx.classificationFile) && !inClass) continue;
      const body = fn.childForFieldName('body');
      if (!body) continue;
      const parent = fn.parent;
      const decoratorText =
        parent?.type === 'decorated_definition'
          ? parent.namedChildren
              .filter((child) => child.type === 'decorator')
              .map((child) => child.text)
              .join(' ')
          : '';
      if (/pytest\.mark\.(?:skip|skipif|xfail)|unittest\.skip/.test(decoratorText)) continue;
      if (/\bpytest\.(?:skip|xfail|importorskip)\s*\(/.test(body.text)) continue;
      const docstring = docstringOf(fn);
      // Doctest-style tests keep their expectations in the docstring.
      if (docstring?.includes('>>>')) continue;
      // `def test_suite(): return DocTestSuite()` is a suite factory.
      if (/TestSuite|load_tests/.test(body.text)) continue;
      const statements = statementsOf(body).filter(
        (statement) =>
          !(statement.type === 'expression_statement' && statement.namedChildren[0]?.type === 'string'),
      );
      if (statements.length === 0) {
        drafts.push({
          message: `test \`${name}\` has an empty body`,
          start: startOf(fn),
          end: endOf(body),
          snippet: snippetOf(ctx, fn),
          confidence: docstring === undefined ? 'high' : 'medium',
          evidence: [`test: ${name}`, 'body contains only a docstring or nothing'],
          help: 'Add an assertion, or delete the test.',
        });
        continue;
      }
      if (!hasAssertion(body)) {
        const delegatesToSelf = bodyCallsSelf(body);
        const delegatedTo = delegatesToLocalHelper(statements, definitions, helperAssertions);
        const parameters = fn.childForFieldName('parameters');
        const parameterCount = parameters
          ? parameters.namedChildren.filter(
              (child) =>
                child.type !== 'comment' &&
                !['*', '/'].includes(child.text.trim()),
            ).length
          : 0;
        const decorated = fn.parent?.type === 'decorated_definition';
        const decoratorText = decorated
          ? fn.parent?.namedChildren
              .filter((child) => child.type === 'decorator')
              .map((child) => child.text)
              .join(' ') ?? ''
          : '';
        const helperDecorator = /contextmanager|staticmethod|classmethod|lru_cache|cached_property/.test(decoratorText);
        // Module-level `test_*` functions that take several parameters, or that
        // are wrapped by a helper decorator, are usually functions *for* tests.
        // camelCase `testR(r)` is a helper convention too; pytest's own tests
        // use `test_` or test classes.
        const camelCase = !name.startsWith('test_');
        const likelyHelper =
          !inClass && (parameterCount >= 2 || helperDecorator || (camelCase && parameterCount >= 1));
        // unittest-style methods routinely delegate assertions to helpers.
        const confidence: Confidence =
          inClass || delegatesToSelf || delegatedTo !== undefined || likelyHelper ? 'medium' : 'high';
        drafts.push({
          message: `test \`${name}\` makes no assertions`,
          start: startOf(fn),
          end: endOf(body),
          snippet: snippetOf(ctx, fn),
          confidence,
          evidence: [
            `test: ${name}`,
            `statements: ${statements.length}`,
            'no assert / raises / mock assertion found',
            ...(delegatesToSelf ? ['the body calls a self.* helper, which may contain the assertions'] : []),
            ...(delegatedTo
              ? [`last statement calls \`${delegatedTo}\`, whose body contains an assertion`]
              : []),
            ...(inClass && !delegatesToSelf ? ['defined inside a test class, where helpers often hold the assertions'] : []),
            ...(likelyHelper ? ['takes several parameters or uses a helper decorator, so it may be a test helper'] : []),
          ],
          help: 'Every test should be able to fail. Add an assertion that depends on the behaviour under test.',
        });
      }
    }
    return drafts;
  },
};

const tautologicalAssert: Rule = {
  meta: {
    id: 'py/tautological-assert',
    title: 'Assertion cannot fail',
    summary: 'Finds `assert True`, `assert 1`, and `x == x` comparisons: assertions that hold regardless of the code.',
    severity: 'warning',
    confidence: 'high',
    languages: ['python'],
    tags: ['tests', 'theater'],
  },
  run(ctx) {
    if (ctx.language !== 'python') return [];
    const drafts: RuleDraft[] = [];

    for (const node of descendantsOfType(ctx.root, ['assert_statement'])) {
      const expression = node.namedChildren[0];
      if (!expression) continue;
      const text = collapseWhitespace(expression.text);
      const literalNoop = text === 'True' || text === '1';
      const negativeComparison = /(?:!=| is not | not in )/.test(` ${text} `);
      const stableOperand = (operand: AstNode | undefined): boolean => {
        if (!operand) return false;
        if (
          ['identifier', 'integer', 'float', 'string', 'true', 'false', 'none'].includes(
            operand.type,
          )
        ) {
          return true;
        }
        if (operand.type === 'parenthesized_expression') {
          return stableOperand(operand.namedChildren[0]);
        }
        if (operand.type === 'attribute') {
          return stableOperand(operand.childForFieldName('object') ?? operand.namedChildren[0]);
        }
        if (operand.type === 'subscript') {
          return (
            stableOperand(operand.childForFieldName('value') ?? operand.namedChildren[0]) &&
            stableOperand(operand.childForFieldName('subscript') ?? operand.namedChildren[1])
          );
        }
        if (operand.type === 'binary_operator' || operand.type === 'boolean_operator') {
          return operand.namedChildren.every((child) => stableOperand(child));
        }
        if (operand.type === 'unary_operator') {
          return stableOperand(operand.namedChildren[0]);
        }
        return false;
      };
      const selfComparison =
        !negativeComparison &&
        expression.type === 'comparison_operator' &&
        expression.namedChildren.length === 2 &&
        expression.namedChildren[0]?.text === expression.namedChildren[1]?.text &&
        stableOperand(expression.namedChildren[0]) &&
        stableOperand(expression.namedChildren[1]) &&
        expression.text.includes('==');
      if (!literalNoop && !selfComparison) continue;

      drafts.push({
        message: `assertion can never fail: \`${truncate(text, 60)}\``,
        start: startOf(node),
        end: endOf(node),
        snippet: snippetOf(ctx, node),
        evidence: [`expression: ${truncate(text, 100)}`],
        help: 'Assert on the actual behaviour (a return value, a raised error, a call) instead of a constant.',
      });
    }
    return drafts;
  },
};

const stubBody: Rule = {
  meta: {
    id: 'py/stub-body',
    title: 'Function body is a placeholder',
    summary:
      'Finds functions whose entire body is `pass`, `...`, `return None` or `raise NotImplementedError`, outside of abstract/Protocol declarations.',
    severity: 'warning',
    confidence: 'high',
    languages: ['python'],
    tags: ['stubs', 'completeness'],
  },
  run(ctx) {
    if (ctx.language !== 'python') return [];
    if (isTestPath(ctx.classificationFile)) return [];
    // Type stubs and deliberate no-op shims are made of `pass`/`...`.
    if (isStubFile(ctx.classificationFile) || isNoopModulePath(ctx.classificationFile) || isDocumentedNoopDirectory(ctx)) return [];
    const drafts: RuleDraft[] = [];

    for (const fn of descendantsOfType(ctx.root, ['function_definition'])) {
      const name = fn.childForFieldName('name')?.text;
      if (!name) continue;
      if (testFunctionName(fn)) continue;
      if (NEVER_STUBS.has(name)) continue;
      if (name.startsWith('__') && name.endsWith('__')) continue;
      const body = fn.childForFieldName('body');
      if (!body) continue;
      if (isAbstractMember(fn)) continue;
      const form = placeholderForm(body);
      if (!form) continue;

      const moduleLevel =
        fn.parent?.type === 'module' ||
        (fn.parent?.type === 'decorated_definition' && fn.parent.parent?.type === 'module');
      const documented = hasDocstring(fn);
      const publicName = !name.startsWith('_');
      let confidence: Confidence = 'medium';
      if (moduleLevel && publicName && !documented && (form === 'pass' || form === '...')) {
        confidence = 'high';
      } else if (form === 'return' || form === 'return None') {
        confidence = 'low';
      }

      drafts.push({
        message: `function \`${name}\` is a stub (body is \`${form}\`)`,
        start: startOf(fn),
        end: endOf(body),
        snippet: snippetOf(ctx, fn),
        confidence,
        evidence: [
          `function: ${name}`,
          `body: ${form}`,
          ...(documented ? ['the function has a docstring, which suggests a documented interface'] : []),
          ...(moduleLevel ? [] : ['defined inside a class or another function']),
        ],
        help:
          form === 'raise NotImplementedError'
            ? 'If this is intentional, make sure callers handle the error; otherwise implement it.'
            : 'Implement it, or raise NotImplementedError with a message so callers fail loudly instead of silently returning None.',
      });
    }
    return drafts;
  },
};

/** A comment that explains why a failure is safe to ignore. */
const FAILURE_WORDS = /error|fail|throw|exception|invalid|log|raise/i;
const INTENT_WORDS = /ignor\w*|abort|skip|safe|accept|fallback|best effort|tolerate|\bok\b|fine/i;
const STRONG_EXPLANATION =
  /harmless|benign|intentional|by design|safe to ignore|expected (?:error|failure|exception|behaviou?r)/i;
/** Comments that describe future work, not why an error is safe to ignore. */
const NOISE_COMMENT =
  /\b(TODO|FIXME|XXX|HACK)\b|\b(later|next (sprint|release|iteration)|someday|eventually)\b/i;

function isExplanationText(text: string): boolean {
  return STRONG_EXPLANATION.test(text) || (FAILURE_WORDS.test(text) && INTENT_WORDS.test(text));
}

function overlaps(comment: CommentRange, fromLine: number, toLine: number): boolean {
  return comment.startLine <= toLine && comment.endLine >= fromLine;
}

/** A comment is standalone when only whitespace precedes its marker. */
function isStandaloneComment(ctx: RuleContext, comment: CommentRange): boolean {
  const line = ctx.lines[comment.startLine - 1] ?? '';
  return line.slice(0, Math.max(0, comment.startColumn - 1)).trim().length === 0;
}

function commentText(ctx: RuleContext, comment: CommentRange): string {
  return ctx.lines.slice(comment.startLine - 1, comment.endLine).join(' ');
}

function explanationCommentBetween(ctx: RuleContext, fromLine: number, toLine: number): boolean {
  return ctx.comments.some(
    (comment) =>
      overlaps(comment, fromLine, toLine) &&
      isStandaloneComment(ctx, comment) &&
      isExplanationText(commentText(ctx, comment)),
  );
}

function supportingCommentBetween(
  ctx: RuleContext,
  fromLine: number,
  toLine: number,
  handlerStartLine: number,
): boolean {
  return ctx.comments.some((comment) => {
    if (!overlaps(comment, fromLine, toLine)) return false;
    const positioned = isStandaloneComment(ctx, comment) || comment.startLine >= handlerStartLine;
    if (!positioned) return false;
    const text = commentText(ctx, comment);
    // A stated explanation wins over future-work wording: "the caller retries
    // later, so we ignore this error" is an explanation, not a TODO.
    if (isExplanationText(text)) return true;
    return !NOISE_COMMENT.test(text);
  });
}

const NOOP_DIR_PREFIX = /^(dummy|noop|no_op|no-op)[-_]/;
const NOOP_MODULE_DOC =
  /dummy implementation|deliberate(?:ly)? no-?op|single-threaded|faux implementation|stand-?in|shim module/i;

/** A prefixed directory is only a shim when its module docstring says so. */
function isDocumentedNoopDirectory(ctx: RuleContext): boolean {
  const dirs = ctx.classificationFile.toLowerCase().split('/').slice(0, -1);
  if (!dirs.some((dir) => NOOP_DIR_PREFIX.test(dir))) return false;
  return NOOP_MODULE_DOC.test(moduleDocstring(ctx.root) ?? '');
}

/** Broad even when the expression is a tuple containing a catch-all type. */
function isBroadExceptionType(text: string): boolean {
  if (/^\(?\s*(Exception|BaseException)\s*,?\s*\)?$/.test(text)) return true;
  if (text.startsWith('(') && text.endsWith(')')) {
    const parts = text
      .slice(1, -1)
      .split(',')
      .map((part) => collapseWhitespace(part))
      .filter((part) => part.length > 0);
    return parts.some((part) => part === 'Exception' || part === 'BaseException');
  }
  return false;
}

const swallowedException: Rule = {
  meta: {
    id: 'py/swallowed-exception',
    title: 'Exception is swallowed silently',
    summary: 'Finds `except` handlers whose whole body is `pass` or `...`, so failures disappear without a trace.',
    severity: 'warning',
    confidence: 'high',
    languages: ['python'],
    tags: ['errors', 'reliability'],
  },
  run(ctx) {
    if (ctx.language !== 'python') return [];
    if (isTestPath(ctx.classificationFile)) return [];
    const drafts: RuleDraft[] = [];

    for (const tryNode of descendantsOfType(ctx.root, ['try_statement'])) {
      // `try: ... except X: pass else: fail()` is an assertion idiom, not a bug.
      if (tryNode.namedChildren.some((child) => child.type === 'else_clause')) continue;
      const tryBody = tryNode.namedChildren.find((child) => child.type === 'block');
      // A comment immediately above `try` often explains the failure policy.
      const aboveStart = Math.max(1, tryNode.startPosition.row);
      const above = explanationCommentBetween(ctx, aboveStart, tryNode.startPosition.row + 1);
      /** 0-based end row of the previous region, or -1 when there is no try body. */
      let previousEndRow = tryBody ? tryBody.endPosition.row : -1;
      for (const clause of tryNode.namedChildren) {
        if (clause.type !== 'except_clause' && clause.type !== 'except_group_clause') continue;
        const body = clause.namedChildren.filter((child) => child.type === 'block').pop();
        if (!body) continue;
        // Comments between the try body (or the previous handler) and this
        // handler can explain this handler; comments inside the try body
        // cannot. Advance the cursor for every handler, silent or not.
        const handlerEndRow = body.endPosition.row;
        const betweenStart = previousEndRow >= 0 ? previousEndRow + 2 : clause.startPosition.row + 1;
        previousEndRow = handlerEndRow;
        const statements = statementsOf(body);
        const silent =
          statements.length === 0 ||
          (statements.length === 1 &&
            (statements[0]?.type === 'pass_statement' ||
              (statements[0]?.type === 'expression_statement' &&
                collapseWhitespace(statements[0].text) === '...')));
        if (!silent) continue;

        const typeText = clause.namedChildren
          .filter((child) => child.type !== 'block' && !isComment(child))
          .map((child) => collapseWhitespace(child.text))
          .join(' ')
          .trim();
        // Optional-dependency idiom: swallowing a missing import is the point.
        if (/ImportError|ModuleNotFoundError/.test(typeText)) continue;

        const commented =
          above ||
          supportingCommentBetween(ctx, betweenStart, handlerEndRow + 1, clause.startPosition.row + 1);
        // `except Exception as error:` binds the exception; the binding name
        // says nothing about the caught type.
        const baseType = typeText.replace(/\s+as\s+\S+$/, '').trim();
        const bare = typeText.length === 0;
        const broad = bare || isBroadExceptionType(baseType);
        const cleanup = insideCleanupFunction(clause);
        const confidence: Confidence = broad && !commented && !cleanup ? 'high' : 'medium';

        drafts.push({
          message: commented
            ? '`except` swallows the error (a comment explains why)'
            : broad
              ? '`except` swallows the error silently'
              : '`except` swallows a specific error type silently',
          start: startOf(clause),
          end: endOf(body),
          snippet: snippetOf(ctx, clause),
          confidence,
          evidence: [
            `handler: ${truncate(collapseWhitespace(clause.text.split(/\r?\n/)[0] ?? ''), 100)}`,
            ...(bare ? ['bare except: catches every exception, including KeyboardInterrupt'] : []),
            ...(cleanup ? ['inside a cleanup/finaliser function, where this is often intentional'] : []),
            ...(commented ? ['a comment explains the suppression'] : []),
          ],
          help: 'Log it, re-raise it, or narrow the exception type and add a comment explaining why it is safe to ignore.',
        });
      }
    }
    return drafts;
  },
};

const deadBranch: Rule = {
  meta: {
    id: 'py/dead-branch',
    title: 'Constant condition',
    summary: 'Finds `if False:`, `if 0:`, `while False:` and `if True:` branches that can never behave as written.',
    severity: 'warning',
    confidence: 'medium',
    languages: ['python'],
    tags: ['control-flow', 'dead-code'],
  },
  run(ctx) {
    if (ctx.language !== 'python') return [];
    if (isTestPath(ctx.classificationFile)) return [];
    const drafts: RuleDraft[] = [];

    for (const node of descendantsOfType(ctx.root, ['if_statement', 'while_statement', 'elif_clause'])) {
      if (insideAbstractMethod(node)) continue;
      const condition = node.childForFieldName('condition');
      if (!condition) continue;
      const text = collapseWhitespace(condition.text).replace(/^\((.*)\)$/, '$1');
      const isDeadFalse = text === 'False' || text === '0' || text === 'None';
      // `while True:` is a legitimate event loop; `if True:` is not.
      const isDeadTrue = text === 'True' || text === '1';
      if (!isDeadFalse && !isDeadTrue) continue;
      if (isDeadTrue && node.type === 'while_statement') continue;

      // `if False:` around imports is the type-checking idiom:
      //   if False:  # or if TYPE_CHECKING:
      //       from foo import Bar
      const block = node.childForFieldName('consequence');
      const statements = block ? statementsOf(block) : [];
      const onlyImports =
        statements.length > 0 &&
        statements.every(
          (statement) => statement.type === 'import_statement' || statement.type === 'import_from_statement',
        );
      if (isDeadFalse && onlyImports) continue;

      const commented = hasCommentBetween(
        ctx,
        Math.max(1, node.startPosition.row),
        node.endPosition.row + 1,
      );

      drafts.push({
        message: isDeadFalse
          ? `\`${node.type === 'while_statement' ? 'while' : 'if'} ${text}:\` is dead code`
          : `\`if ${text}:\` makes the else-branch unreachable`,
        start: startOf(node),
        end: endOf(condition),
        snippet: snippetOf(ctx, node),
        confidence: isDeadFalse && !commented ? 'high' : 'medium',
        evidence: [`condition: ${text}`, ...(commented ? ['a nearby comment suggests this is a deliberate switch'] : [])],
        help: 'Replace the constant with the flag or configuration value it is standing in for.',
      });
    }
    return drafts;
  },
};

const unreachable: Rule = {
  meta: {
    id: 'py/unreachable',
    title: 'Statement after an unconditional exit',
    summary: 'Finds statements placed after `return`, `raise`, `break` or `continue` in the same block.',
    severity: 'error',
    confidence: 'high',
    languages: ['python'],
    tags: ['control-flow', 'dead-code'],
    fixable: true,
  },
  run(ctx) {
    if (ctx.language !== 'python') return [];
    if (isTestPath(ctx.classificationFile)) return [];
    const drafts: RuleDraft[] = [];
    const seen = new Set<AstNode>();

    for (const block of descendantsOfType(ctx.root, ['block'])) {
      const statements = statementsOf(block);
      const index = statements.findIndex((statement) => TERMINATORS.has(statement.type));
      if (index === -1) continue;
      const firstUnreachable = statements[index + 1];
      if (!firstUnreachable || seen.has(firstUnreachable)) continue;
      seen.add(firstUnreachable);
      const terminator = statements[index];
      if (!terminator) continue;
      const trailing = statements.slice(index + 1);
      const count = trailing.length;
      const keyword = terminator.type.replace('_statement', '');

      drafts.push({
        message: `code after \`${keyword}\` is unreachable`,
        start: startOf(firstUnreachable),
        end: endOf(firstUnreachable),
        snippet: snippetOf(ctx, firstUnreachable),
        evidence: [`${count} statement(s) follow the \`${keyword}\` at line ${terminator.startPosition.row + 1}`],
        help: 'Delete the unreachable code, or move it before the exit if it was meant to run.',
        fix: { edits: statementDeletionEdits(ctx.source, trailing) },
      });
    }
    return drafts;
  },
};

export const pythonRules: Rule[] = [
  phantomImport,
  noopTest,
  tautologicalAssert,
  stubBody,
  swallowedException,
  deadBranch,
  unreachable,
];
