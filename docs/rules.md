# Rule reference

Every rule runs on a real AST (tree-sitter), reports a **confidence**, and has at least one negative test that proves it does *not* fire on legitimate code.

- **Severity** is what the finding means; **confidence** is how sure we are. Only `high` is shown by default and fails CI.
- **Test files**: rules about dead code, stubs and swallowed errors skip test files (`test/`, `tests/`, `__tests__/`, `test_*.py`, `*_test.py`, `*.test.ts`, `*.spec.ts`) and test/build infrastructure (`conftest.py`, `noxfile.py`, `docs/conf.py`), because that scaffolding is full of intentional stubs. `noop-test` and `tautological-assert` are the rules that look *at* tests.
- **Parse errors**: a file that did not parse cleanly can never produce a `high` finding; its findings are demoted to `medium` with an evidence line explaining why.
- Rule ids are stable; use them in `slopgate-ignore-*` directives and `.slopgate.json`.

| Rule | Language | Severity | Confidence |
| --- | --- | --- | --- |
| [`py/phantom-import`](#pyphantom-import) | Python | error | high (medium in test files) |
| [`py/noop-test`](#pynoop-test) | Python | warning | high / medium |
| [`py/tautological-assert`](#pytautological-assert) | Python | warning | high |
| [`py/stub-body`](#pystub-body) | Python | warning | high / medium / low |
| [`py/swallowed-exception`](#pyswallowed-exception) | Python | warning | high / medium |
| [`py/dead-branch`](#pydead-branch) | Python | warning | high / medium |
| [`py/unreachable`](#pyunreachable) | Python | error | high |
| [`ts/phantom-import`](#tsphantom-import) | TS/JS | error | high / medium |
| [`ts/noop-test`](#tsnoop-test) | TS/JS | warning | high |
| [`ts/tautological-assert`](#tstautological-assert) | TS/JS | warning | high |
| [`ts/stub-function`](#tsstub-function) | TS/JS | warning | high / medium |
| [`ts/swallowed-exception`](#tsswallowed-exception) | TS/JS | warning | medium |
| [`ts/dead-branch`](#tsdead-branch) | TS/JS | warning | high / medium |
| [`ts/unreachable`](#tsunreachable) | TS/JS | error | high |

---

## py/phantom-import

**What it catches.** An import whose top-level module is not in the Python standard library, is not provided by a file or directory in the repository, and is not declared in `pyproject.toml`, `requirements*.txt`, `setup.py`, `setup.cfg` or `Pipfile`.

```python
import requests_v2          # nobody declared this, nobody wrote it → finding
from helper import render   # no helper.py anywhere          → finding
```

```python
import os                   # stdlib
import requests             # declared in pyproject.toml
from . import sibling       # relative
try:
    import ujson            # optional dependency pattern
except ImportError:
    ujson = None
```

**Precision controls.** Import-name to distribution-name map (`yaml` → `pyyaml`, `PIL` → `pillow`, …, including dotted prefixes such as `google.protobuf`), local-module discovery from the repository layout (every module stem, not just top-level), `try/except ImportError` detection, imports under platform/version guards (`sys.platform`, `sys.version_info`, `six.PY2`, …) ignored, `_`-prefixed C-extension modules (`_socket`, `_winapi`) ignored, `ignoreModules` config, and **medium confidence inside test files**, where `sys.path` monkey-patching is common.

---

## py/noop-test

**What it catches.** A function named `test_*` (or `testCamelCase`) whose body has no `assert`, no `pytest.raises` / `pytest.warns` / `pytest.deprecated_call`, no `self.assert*`, no mock verification, and no `expect`-style call. A bare `warnings.warn()` is not an assertion and does not count.

```python
def test_create_user():
    create_user("a@b.c")     # runs the code, asserts nothing → finding
```

**When it stays quiet, or lowers confidence.**

- The file is not a test module (`test_*.py`, `*_test.py`) and the function is not a method of a class → skipped, because `test_*` helpers exist in test-support tooling.
- The test is inside `if __name__ == "__main__":` → skipped (demo code).
- The body is a docstring with `>>>` → skipped (doctest).
- The body returns a `DocTestSuite`/`load_tests` → skipped (suite factory).
- The test is a class method, or calls `self.*`, or takes two or more parameters, or uses a camelCase `testX` name with a parameter, or uses a `@contextmanager`-style decorator → **medium**: it probably delegates its assertions to a helper.
- The test’s **last statement** calls a module-local function whose body contains an assertion (`def test_x(): run_suite(...)`) → **medium**. This is one level only: a helper that itself calls another helper is not followed.

**Why it matters.** A test that cannot fail is worse than no test: it inflates coverage, signals safety, and catches nothing.

---

## py/tautological-assert

**What it catches.** An assertion that holds regardless of the code: `assert True`, `assert 1`, `assert x == x`, `assert 1 == 1`.

```python
assert True
assert user == user
```

**Not reported.** `assert False` (an intentional "unreachable" marker), `assert x != x` (always fails), any comparison with two different operands.

---

## py/stub-body

**What it catches.** A function whose entire body is `pass`, `...`, `return` / `return None`, or `raise NotImplementedError`.

```python
def sync_accounts(self):
    pass                     # signature without implementation → finding
```

**Confidence.** `high` only for a module-level, public, undocumented function whose body is `pass`/`...`; a top-level `@decorator` does not change that. Everything else is `medium` (`raise NotImplementedError`, documented functions, methods, private helpers, `return None` → `low`), because interface placeholders and abstract hooks look identical to abandoned stubs. When auditing AI-generated code, most real stub findings are `medium`; use `--confidence medium` (see README “Auditing AI-written code”).

**Not reported.** `@abstractmethod` and `Protocol` members, `__init__`/`__new__`/`__post_init__`/`setUp`/`tearDown`, functions inside `if TYPE_CHECKING:`, `.pyi` type stubs, deliberate no-op modules with an exact `dummy/`, `_dummy/`, `noop/` or `no-op/` path segment, a file stem starting with `dummy_`/`noop_`/`_dummy_`, or a prefixed `dummy_*`/`noop_*` directory whose module docstring says it is a shim; test files, and anything named `test_*` (handled by `py/noop-test`).

---

## py/swallowed-exception

**What it catches.** An `except` handler whose body is only `pass` or `...`.

```python
try:
    send_webhook(payload)
except Exception:
    pass                     # failure disappears → finding (high)
```

**Confidence.**

- `high` only for a bare `except:` or a broad type (`Exception` / `BaseException`), with no explanatory comment, outside a cleanup function. Binding the exception (`except Exception as error:`) does not narrow the type; a tuple containing `Exception`/`BaseException` is broad too.
- `medium` when the caught type is specific (`except KeyError`), when a standalone comment explains it — immediately above `try` with explanation wording, between the try body and this handler (or between handlers), on the `except` line, or inside the handler — or when it sits inside `close`/`__del__`/`shutdown`/`cleanup`-style code.
- Only TODO/FIXME/XXX/HACK tags and future-work wording (`later`, `next sprint/release/iteration`, `someday`, `eventually`) are treated as noise. A real explanation takes priority: “the caller retries later, so we ignore this error” is `medium`, while “refactor this later” is `high`. `cleanup` and `refactor` are valid explanation vocabulary when they explain why the failure is safe to ignore.
- Trailing comments on preceding code lines never count. Above-`try` comments need a failure word plus an intent word (“any errors, just abort”), or a strong phrase such as “harmless” / “safe to ignore”; a bare “known bug” without intent wording stays `high` by design.

**Not reported.** `except ImportError` / `ModuleNotFoundError` (the optional-dependency idiom), `try` blocks with an `else` clause (the `try/except: pass/else: fail` assertion idiom), test files, and handlers that log or re-raise.

---

## py/dead-branch

**What it catches.** `if` / `while` with a constant condition: `False`, `0`, `None` (high), `True`, `1` (medium).

```python
if False:
    enable_new_path()
```

**Not reported.** `while True:` (a normal event loop), `if False:` blocks that contain only imports (the type-checking idiom), anything inside an abstract method, and test files. A nearby comment demotes the finding to `medium` — it is usually a deliberate switch.

---

## py/duplicate-block

**What it catches.** The same normalized function body in two or more Python files. Comments and whitespace are ignored; identifiers and literals are preserved, so renaming a local variable makes the bodies different. A body must span at least **6 lines** and contain at least **15 leaf tokens**.

**Not reported.** Copies inside a single file, test files, bodies below the threshold, files with syntax errors, and semantic clones with renamed identifiers. This is deliberately exact normalization, not a clone detector.

**Confidence.** `medium`: duplication can be intentional boilerplate. Each occurrence is reported with the other locations.

---

## py/unreachable

**What it catches.** Statements after `return`, `raise`, `break` or `continue` in the same block.

```python
def get_user(user_id):
    return repository.load(user_id)
    audit_log.record(user_id)   # never runs → finding
```

Only the same-block case is reported. Test files are skipped — generators there deliberately place `yield` after `raise`.

**Fixable.** `slopgate --fix` deletes every statement after the terminator in that block. `--fix-dry-run` validates the edit without writing.

---

## ts/phantom-import

**What it catches.** An import/`require`/re-export whose bare specifier is not:

- a Node builtin (`fs`, `node:fs`, …)
- relative (`./`, `../`, `/`)
- a path alias from `tsconfig.json`, `tsconfig.app.json`, `tsconfig.base.json`, `tsconfig.node.json` or `jsconfig.json` (including relative `extends` chains and project references)
- a familiar virtual prefix (`@/`, `~/`, `$lib/`, `$app/`, `$env/`, `npm:`, `jsr:`) even when no config was parsed
- a workspace package
- an asset (`.css`, `.svg`, `.json`, …)
- declared in `package.json` (deps, devDeps, peerDeps, optionalDeps — including workspace manifests)

Also ignored: URL specifiers (`https://unpkg.com/...`), virtual-module schemes, asset imports, and `require()` calls inside a `try` block (the optional-dependency idiom). Custom `vite.config` `resolve.alias` entries are not parsed yet; put them in a tsconfig `paths` map for now.

If the package **is** installed under `node_modules` the finding is `medium` ("undeclared"). If it is not installed at all, it is `high` ("phantom"), except inside test files, where it is also `medium`.

---

## ts/noop-test

**What it catches.** A test whose callback has an empty body or no assertion. Recognises `assert` / `node:assert` methods, renamed `node:assert` imports (namespace, default, named aliases and `require` bindings), Tape/TAP (`t.equal`, `t.deepEqual`, `t.strictEqual`, `t.doesNotThrow`, …), `expect(...)` chains, `expectTypeOf`, `should`, `chai`, and `node:test` context assertions (`t.ok`, `t.assert.*`).

**Delegation.** If the callback’s first parameter is passed as an argument to a helper (`(t) => runSuite(t)`), the finding is `medium`: the helper may contain the assertions. Passing it as a receiver (`t.equal(...)`) is still a normal assertion; callbacks with several parameters are treated as table-driven data, not delegated context.

**Disabled tests.** `test.skip`, `test.todo`, `test.fixme`, `xdescribe`, `xcontext`, `xsuite`, and tests nested under `describe.skip` / `context.skip` / `suite.skip` are not reported. Cypress/Playwright-style commands (`cy.*`, `page.*`, `browser.*`) can fail a test implicitly, so an otherwise assertion-free test is demoted to `medium` rather than `high`.

```ts
test('creates user', () => {
  createUser('a@b.c');       // no expect() → finding
});
```

---

## ts/tautological-assert

**What it catches.** `expect(<literal>).toBe(<same literal>)`, `expect(x).toEqual(x)`, `expect(true).toBeTruthy()`.

---

## ts/stub-function

**What it catches.** A `function` declaration or class method whose body is empty, or only throws an error with a `not implemented` / `unimplemented` / `Not yet implemented` message.

**Confidence.** `high` only for a standalone or exported function with the explicit `throw new Error("not implemented")` placeholder. An empty body is `medium`, and a class method that throws the placeholder is `medium` too: it is the standard way to declare an interface member for subclasses. Callbacks, dispatch tables and interface implementations legitimately do nothing in JavaScript. When auditing AI-generated code, most real stub findings are `medium`; use `--confidence medium` (see README “Auditing AI-written code”).

**Not reported.** Constructors, abstract members, overload signatures, ambient declarations, object-literal methods (`{ native() {} }` is a dispatch table), no-op conventions (`noop`, `noOp`, `nop`, `ignore`, `identity`), members documented with `@abstract` / `@noop`, and test files.

**Arrows.** Only reported when they throw the "not implemented" placeholder. Object-literal arrow properties (`{ toggle: () => { throw ... } }`) are `medium`, like class-method interface stubs; standalone arrows stay `high`.

---

## ts/swallowed-exception

**What it catches.** A `catch` clause with an empty body.

```ts
try {
  await save();
} catch {
  // finding at medium confidence: empty catch is idiomatic in JS
}
```

**Confidence is `medium` by design.** `catch {}` is how JavaScript does best-effort cleanup; claiming high confidence would be dishonest. Use `--confidence medium` to see these.

---

## ts/dead-branch

**What it catches.** `if (false)`, `if (0)`, `while (false)` (high) and `if (true)` / `if (1)` (medium). Test files are skipped. A nearby comment demotes the finding to `medium`, matching `py/dead-branch`: it is usually a deliberate switch.

---

## ts/duplicate-block

**What it catches.** The same normalized function or method body in two or more TypeScript/JavaScript files. Function declarations, class methods, and function/arrow values assigned to variables are considered. Comments and whitespace are ignored; identifiers and literals are preserved. A body must span at least **6 lines** and contain at least **15 leaf tokens**.

**Not reported.** Callbacks passed to other calls, copies inside a single file, test files, bodies below the threshold, files with syntax errors, and semantic clones with renamed identifiers.

**Confidence.** `medium`: duplication can be intentional boilerplate. Each occurrence is reported with the other locations.

---

## ts/unreachable

**What it catches.** Statements after `return`, `throw`, `break` or `continue` in the same block. Test files are skipped.

**Not reported.** Hoisted declarations after the exit (`function` declarations and generators, bare `var a, b;`) and type-only declarations erased at compile time (`type`, `interface`, `declare`). `enum` declarations, classes, `let`/`const` and initialised `var` statements execute at their position and are reported.

**Fixable.** `slopgate --fix` deletes the unreachable runtime statements but leaves hoisted/erased declarations in place. `--fix-dry-run` validates the edits without writing.
