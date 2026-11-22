# Rule reference

Every rule runs on a real AST (tree-sitter), reports a **confidence**, and has at least one negative test that proves it does *not* fire on legitimate code.

- **Severity** is what the finding means; **confidence** is how sure we are. Only `high` is shown by default and fails CI.
- **Test files**: rules about dead code, stubs and swallowed errors skip test files (`test/`, `tests/`, `__tests__/`, `test_*.py`, `*_test.py`, `*.test.ts`, `*.spec.ts`), because test scaffolding is full of intentional stubs. `noop-test` and `tautological-assert` are the rules that look *at* tests.
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

**Precision controls.** Import-name to distribution-name map (`yaml` → `pyyaml`, `PIL` → `pillow`, …), local-module discovery from the repository layout (every module stem, not just top-level), `try/except ImportError` detection, `_`-prefixed C-extension modules (`_socket`, `_winapi`) ignored, `ignoreModules` config, and **medium confidence inside test files**, where `sys.path` monkey-patching is common.

---

## py/noop-test

**What it catches.** A function named `test_*` (or `testCamelCase`) whose body has no `assert`, no `pytest.raises`, no `self.assert*`, no mock verification, and no `expect`-style call.

```python
def test_create_user():
    create_user("a@b.c")     # runs the code, asserts nothing → finding
```

**When it stays quiet, or lowers confidence.**

- The file is not a test module (`test_*.py`, `*_test.py`) and the function is not a method of a class → skipped, because `test_*` helpers exist in test-support tooling.
- The test is inside `if __name__ == "__main__":` → skipped (demo code).
- The body is a docstring with `>>>` → skipped (doctest).
- The body returns a `DocTestSuite`/`load_tests` → skipped (suite factory).
- The test is a class method, or calls `self.*`, or takes two or more parameters, or uses a `@contextmanager`-style decorator → **medium**: it probably delegates its assertions to a helper.

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

**Confidence.** `high` only for a module-level, public, undocumented function whose body is `pass`/`...`. Everything else is `medium` (`raise NotImplementedError`, documented functions, methods, private helpers, `return None` → `low`), because interface placeholders and abstract hooks look identical to abandoned stubs.

**Not reported.** `@abstractmethod` and `Protocol` members, `__init__`/`__new__`/`__post_init__`/`setUp`/`tearDown`, functions inside `if TYPE_CHECKING:`, test files, and anything named `test_*` (handled by `py/noop-test`).

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

- `high` only for a bare `except:` or `except Exception` / `BaseException`, with no comment, outside a cleanup function.
- `medium` when the caught type is specific (`except KeyError`), when a comment explains it, or when it sits inside `close`/`__del__`/`shutdown`/`cleanup`-style code.

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

## py/unreachable

**What it catches.** Statements after `return`, `raise`, `break` or `continue` in the same block.

```python
def get_user(user_id):
    return repository.load(user_id)
    audit_log.record(user_id)   # never runs → finding
```

Only the same-block case is reported. Test files are skipped — generators there deliberately place `yield` after `raise`.

---

## ts/phantom-import

**What it catches.** An import/`require`/re-export whose bare specifier is not:

- a Node builtin (`fs`, `node:fs`, …)
- relative (`./`, `../`, `/`)
- a path alias from `tsconfig.json` `compilerOptions.paths`
- a workspace package
- an asset (`.css`, `.svg`, `.json`, …)
- declared in `package.json` (deps, devDeps, peerDeps, optionalDeps — including workspace manifests)

Also ignored: URL specifiers (`https://unpkg.com/...`), virtual-module schemes, asset imports, and `require()` calls inside a `try` block (the optional-dependency idiom).

If the package **is** installed under `node_modules` the finding is `medium` ("undeclared"). If it is not installed at all, it is `high` ("phantom"), except inside test files, where it is also `medium`.

---

## ts/noop-test

**What it catches.** A `test()` / `it()` / `test.only()` call whose callback has an empty body, no assertion, or only calls code. Handles both block bodies and expression bodies.

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

**What it catches.** A `function` declaration or class method whose body is empty, or only throws an error with a "not implemented" message.

**Confidence.** `high` only for the explicit `throw new Error("not implemented")` placeholder. An empty body is `medium`: callbacks, dispatch tables and interface implementations legitimately do nothing in JavaScript.

**Not reported.** Constructors, abstract members, overload signatures, ambient declarations, object-literal methods (`{ native() {} }` is a dispatch table), no-op conventions (`noop`, `noOp`, `nop`, `ignore`, `identity`), members documented with `@abstract` / `@noop`, and test files.

**Arrows.** Only reported when they throw the "not implemented" placeholder.

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

**What it catches.** `if (false)`, `if (0)`, `while (false)` (high) and `if (true)` / `if (1)` (medium). Test files are skipped.

---

## ts/unreachable

**What it catches.** Statements after `return`, `throw`, `break` or `continue` in the same block. Test files are skipped.
