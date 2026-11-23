import assert from 'node:assert/strict';
import test from 'node:test';
import { makeDeps, runRule, runRuleOnFile } from './helpers.ts';

test('py/phantom-import flags an import that is neither declared nor local', async () => {
  const drafts = await runRule('py/phantom-import', 'import numpy_extra\n', 'python');
  assert.equal(drafts.length, 1);
  assert.match(drafts[0]?.message ?? '', /numpy_extra/);
  assert.equal(drafts[0]?.confidence, undefined);
});

test('py/phantom-import stays quiet for stdlib, declared, local and optional imports', async () => {
  const source = [
    'import os',
    'import requests',
    'import mymodule',
    'from . import sibling',
    'try:',
    '    import ujson',
    'except ImportError:',
    '    ujson = None',
  ].join('\n');
  const deps = makeDeps({ pythonDeclared: ['requests'], pythonLocal: ['mymodule'] });
  const drafts = await runRule('py/phantom-import', source, 'python', deps);
  assert.deepEqual(drafts, []);
});

test('py/phantom-import understands import-name to distribution-name mappings', async () => {
  const source = [
    'import docx',
    'import grpc',
    'import git',
    'import pptx',
    'from google.protobuf import message',
  ].join('\n');
  const deps = makeDeps({
    pythonDeclared: ['python-docx', 'grpcio', 'gitpython', 'python-pptx', 'protobuf'],
  });
  const drafts = await runRule('py/phantom-import', source, 'python', deps);
  assert.deepEqual(drafts, []);
});

test('py/phantom-import maps usb to pyusb', async () => {
  const deps = makeDeps({ pythonDeclared: ['pyusb'] });
  const drafts = await runRule('py/phantom-import', 'import usb\n', 'python', deps);
  assert.deepEqual(drafts, []);
});

test('py/phantom-import does not map every google import to protobuf', async () => {
  const drafts = await runRule(
    'py/phantom-import',
    'from google.cloud import storage\n',
    'python',
    makeDeps({ pythonDeclared: ['protobuf'] }),
  );
  assert.equal(drafts.length, 1);
  assert.match(drafts[0]?.message ?? '', /google\.cloud/);
});

test('py/stub-body skips .pyi stubs and no-op shim modules', async () => {
  const source = 'def load_config(path: str) -> int: ...\n';
  assert.deepEqual(await runRuleOnFile('py/stub-body', source, 'python', 'pkg/types.pyi'), []);

  const dummy = 'def freeze_support():\n    pass\n';
  assert.deepEqual(
    await runRuleOnFile('py/stub-body', dummy, 'python', 'multiprocessing/dummy/__init__.py'),
    [],
  );
});

test('py/swallowed-exception counts a comment between try and except', async () => {
  const source = [
    'def describe(obj):',
    '    try:',
    '        obj.__orig_class__ = obj',
    '    # Expected on objects that reject attribute assignment.',
    '    except Exception:',
    '        pass',
    '    return obj',
  ].join('\n');
  const drafts = await runRuleOnFile('py/swallowed-exception', source, 'python', 'app.py');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'medium');
});

test('py/swallowed-exception ignores a comment inside the try body', async () => {
  const source = [
    'def parse(raw):',
    '    try:',
    '        # Normalise the payload shape.',
    '        data = json.loads(raw)',
    '        return data',
    '    except Exception:',
    '        pass',
  ].join('\n');
  const drafts = await runRuleOnFile('py/swallowed-exception', source, 'python', 'app.py');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'high');
});

test('py/swallowed-exception scopes comments to the following handler', async () => {
  const source = [
    'def f():',
    '    try:',
    '        run()',
    '    # first handler is intentionally silent',
    '    except ValueError:',
    '        pass',
    '    except Exception:',
    '        pass',
  ].join('\n');
  const drafts = await runRuleOnFile('py/swallowed-exception', source, 'python', 'app.py');
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0]?.confidence, 'medium');
  assert.equal(drafts[1]?.confidence, 'high');
});

test('py/swallowed-exception accepts an explanatory comment above try', async () => {
  const source = [
    'def f(ctx):',
    '    # any error here is expected; just abort',
    '    try:',
    '        ctx.flush()',
    '    except Exception:',
    '        pass',
  ].join('\n');
  const drafts = await runRuleOnFile('py/swallowed-exception', source, 'python', 'app.py');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'medium');
});

test('py/swallowed-exception ignores a non-explanatory comment above try', async () => {
  const source = [
    'def f(raw):',
    '    # Parse the payload into JSON.',
    '    try:',
    '        return json.loads(raw)',
    '    except Exception:',
    '        pass',
  ].join('\n');
  const drafts = await runRuleOnFile('py/swallowed-exception', source, 'python', 'app.py');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'high');
});

test('py/swallowed-exception ignores a trailing comment on the last try-body line', async () => {
  const source = [
    'def f(ctx):',
    '    try:',
    '        ctx.flush()  # flush is best effort',
    '    except Exception:',
    '        pass',
  ].join('\n');
  const drafts = await runRuleOnFile('py/swallowed-exception', source, 'python', 'app.py');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'high');
});

test('py/stub-body handles dummy_threading-style module names', async () => {
  const source = 'def start_new_thread(function, args, kwargs={}):\n    pass\n';
  assert.deepEqual(await runRuleOnFile('py/stub-body', source, 'python', 'dummy_threading.py'), []);
  const drafts = await runRuleOnFile('py/stub-body', source, 'python', 'dummy_data/loader.py');
  assert.equal(drafts.length, 1);
});

test('py/swallowed-exception ignores a trailing comment on the preceding code line', async () => {
  const source = [
    'def f(ctx):',
    '    value = ctx.read()  # returns an error string when invalid',
    '    try:',
    '        ctx.flush(value)',
    '    except Exception:',
    '        pass',
  ].join('\n');
  const drafts = await runRuleOnFile('py/swallowed-exception', source, 'python', 'app.py');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'high');
});

test('py/swallowed-exception ignores a TODO comment between try and except', async () => {
  const source = [
    'def f(ctx):',
    '    try:',
    '        ctx.flush()',
    '    # TODO: this block is long, refactor it next sprint',
    '    except Exception:',
    '        pass',
  ].join('\n');
  const drafts = await runRuleOnFile('py/swallowed-exception', source, 'python', 'app.py');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'high');
});

test('py/swallowed-exception accepts an inline comment on the handler line', async () => {
  const source = [
    'def f(ctx):',
    '    try:',
    '        ctx.flush()',
    '    except Exception:',
    '        pass  # result will be None',
  ].join('\n');
  const drafts = await runRuleOnFile('py/swallowed-exception', source, 'python', 'app.py');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'medium');
});

test('py/swallowed-exception accepts an inline comment on the except line', async () => {
  const source = [
    'def f(ctx):',
    '    try:',
    '        ctx.flush()',
    '    except:  # already logged by the transport layer',
    '        pass',
  ].join('\n');
  const drafts = await runRuleOnFile('py/swallowed-exception', source, 'python', 'app.py');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'medium');
  assert.match(drafts[0]?.message ?? '', /a comment explains why/);
});

test('py/swallowed-exception treats a broad except with an inline comment as commented', async () => {
  const source = [
    'def f(ctx):',
    '    try:',
    '        ctx.flush()',
    '    except Exception:  # cleanup is the caller job; the failure is harmless',
    '        pass',
  ].join('\n');
  const drafts = await runRuleOnFile('py/swallowed-exception', source, 'python', 'app.py');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'medium');
  assert.doesNotMatch(drafts[0]?.message ?? '', /specific error type/);
});

test('py/stub-body skips a prefixed shim directory with a no-op docstring', async () => {
  const source = [
    '"""Dummy implementations of the multiprocessing API, for single-threaded builds.',
    '',
    'Every function here is a deliberate no-op.',
    '"""',
    '',
    'def freeze_support():',
    '    pass',
  ].join('\n');
  assert.deepEqual(
    await runRuleOnFile('py/stub-body', source, 'python', 'dummy_multiprocessing/__init__.py'),
    [],
  );
  const noDocstring = 'def freeze_support():\n    pass\n';
  assert.equal(
    (await runRuleOnFile('py/stub-body', noDocstring, 'python', 'dummy_multiprocessing/__init__.py')).length,
    1,
  );
  const realModule = [
    '"""A real module that happens to live in a dummy-prefixed directory."""',
    '',
    'def load():',
    '    pass',
  ].join('\n');
  assert.equal(
    (await runRuleOnFile('py/stub-body', realModule, 'python', 'dummy_data/loader.py')).length,
    1,
  );
});

test('py/noop-test delegates to a local assert helper only on the last statement', async () => {
  const source = [
    'def run_suite(cases):',
    '    assert cases',
    '',
    'def compute():',
    '    return 1',
    '',
    'def test_delegates():',
    '    run_suite([])',
    '',
    'def test_helper_not_last():',
    '    run_suite([])',
    '    compute()',
    '',
    'def test_plain():',
    '    compute()',
  ].join('\n');
  const drafts = await runRuleOnFile('py/noop-test', source, 'python', 'test_app.py');
  assert.equal(drafts.length, 3);
  assert.equal(drafts.filter((draft) => draft.confidence === 'medium').length, 1);
  assert.equal(drafts.find((draft) => draft.confidence === 'medium')?.start.line, 7);
  assert.equal(drafts.filter((draft) => draft.confidence === 'high').length, 2);
});

test('py/noop-test caches helper checks and ignores unknown calls', async () => {
  const source = [
    'def run_suite(cases):',
    '    assert cases',
    '',
    'def compute():',
    '    return 1',
    '',
    'def test_a():',
    '    run_suite([])',
    '',
    'def test_b():',
    '    run_suite([])',
    '',
    'def test_c():',
    '    compute()',
    '',
    'def test_imported():',
    '    helper()',
  ].join('\n');
  const drafts = await runRuleOnFile('py/noop-test', source, 'python', 'test_app.py');
  assert.equal(drafts.length, 4);
  assert.equal(drafts.filter((draft) => draft.confidence === 'medium').length, 2);
  assert.equal(drafts.filter((draft) => draft.confidence === 'high').length, 2);
});

test('py/swallowed-exception classifies bindings by the caught type', async () => {
  const cases = [
    ['except Exception as error:', 'high'],
    ['except BaseException as error:', 'high'],
    ['except (Exception,) as error:', 'high'],
    ['except (ValueError, Exception) as error:', 'high'],
    ['except (ValueError, RuntimeError) as error:', 'medium'],
  ] as const;
  for (const [header, expected] of cases) {
    const source = ['def f():', '    try:', '        work()', `    ${header}`, '        pass'].join('\n');
    const drafts = await runRuleOnFile('py/swallowed-exception', source, 'python', 'app.py');
    assert.equal(drafts.length, 1, header);
    assert.equal(drafts[0]?.confidence, expected, header);
    if (expected === 'high') assert.doesNotMatch(drafts[0]?.message ?? '', /specific/, header);
  }
});

test('py/phantom-import ignores imports under sys.version_info guards', async () => {
  const source = [
    'import sys',
    'if sys.version_info[0] < 3:',
    '    import urllib2',
    '    from StringIO import StringIO',
  ].join('\n');
  assert.deepEqual(await runRule('py/phantom-import', source, 'python'), []);
});

test('py/phantom-import treats conftest.py as test infrastructure', async () => {
  const drafts = await runRuleOnFile(
    'py/phantom-import',
    'import pytest\n',
    'python',
    'tests/conftest.py',
  );
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'medium');
});

test('py/phantom-import ignores imports under a platform guard', async () => {
  const source = ['import sys', "if sys.platform == 'java':", '    from java.lang import System'].join('\n');
  assert.deepEqual(await runRule('py/phantom-import', source, 'python'), []);
});

test('py/noop-test demotes camelCase test helpers with parameters', async () => {
  const drafts = await runRuleOnFile(
    'py/noop-test',
    'def testR(r):\n    print(r)\n',
    'python',
    'test/test_itertools.py',
  );
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'medium');
});

test('py/noop-test flags tests without assertions', async () => {
  const drafts = await runRuleOnFile('py/noop-test', 'def test_add():\n    add(1, 2)\n', 'python', 'tests/test_app.py');
  assert.equal(drafts.length, 1);
  assert.match(drafts[0]?.message ?? '', /makes no assertions/);
});

test('py/noop-test accepts pytest warning assertions', async () => {
  const warns = await runRuleOnFile(
    'py/noop-test',
    ['def test_warns():', '    with pytest.warns(UserWarning):', '        warnings.warn("x")'].join('\n'),
    'python',
    'tests/test_app.py',
  );
  assert.deepEqual(warns, []);
  const deprecated = await runRuleOnFile(
    'py/noop-test',
    ['def test_deprecated():', '    with pytest.deprecated_call():', '        old()'].join('\n'),
    'python',
    'tests/test_app.py',
  );
  assert.deepEqual(deprecated, []);
  const plainWarn = await runRuleOnFile(
    'py/noop-test',
    ['def test_only_warns():', '    warnings.warn("x")'].join('\n'),
    'python',
    'tests/test_app.py',
  );
  assert.equal(plainWarn.length, 1);
  assert.match(plainWarn[0]?.message ?? '', /makes no assertions/);
});

test('py/noop-test flags empty tests and accepts real assertions', async () => {
  const empty = await runRuleOnFile('py/noop-test', 'def test_add():\n    """later"""\n', 'python', 'tests/test_app.py');
  assert.equal(empty.length, 1);
  assert.match(empty[0]?.message ?? '', /empty body/);

  const real = await runRuleOnFile(
    'py/noop-test',
    'def test_add():\n    assert add(1, 2) == 3\n',
    'python',
    'tests/test_app.py',
  );
  assert.deepEqual(real, []);

  const mock = await runRuleOnFile(
    'py/noop-test',
    'def test_calls():\n    client.send.assert_called_once()\n',
    'python',
    'tests/test_app.py',
  );
  assert.deepEqual(mock, []);
});

test('py/noop-test ignores functions that are not tests', async () => {
  const drafts = await runRule('py/noop-test', 'def testing_helpers():\n    pass\n', 'python');
  assert.deepEqual(drafts, []);
});

test('py/noop-test only trusts real test modules or test classes', async () => {
  const moduleLevel = 'def test_helper():\n    go()\n';
  assert.deepEqual(await runRuleOnFile('py/noop-test', moduleLevel, 'python', 'support/tools.py'), []);
  assert.equal((await runRuleOnFile('py/noop-test', moduleLevel, 'python', 'tests/test_tools.py')).length, 1);

  const inClass = 'class TestThing:\n    def test_x(self):\n        go()\n';
  const drafts = await runRuleOnFile('py/noop-test', inClass, 'python', 'support/tools.py');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'medium');
});

test('py/tautological-assert finds constant and self comparisons', async () => {
  assert.equal((await runRule('py/tautological-assert', 'assert True\n', 'python')).length, 1);
  assert.equal((await runRule('py/tautological-assert', 'assert 1 == 1\n', 'python')).length, 1);
  assert.equal((await runRule('py/tautological-assert', 'def f(x):\n    assert x == x\n', 'python')).length, 1);
});

test('py/tautological-assert accepts real assertions', async () => {
  assert.deepEqual(await runRule('py/tautological-assert', 'def f(x):\n    assert x > 0\n', 'python'), []);
  assert.deepEqual(await runRule('py/tautological-assert', 'def f(x):\n    assert x != x\n', 'python'), []);
  assert.deepEqual(await runRule('py/tautological-assert', 'assert False\n', 'python'), []);
  assert.deepEqual(
    await runRule('py/tautological-assert', 'def f():\n    assert parse("x") == parse("x")\n', 'python'),
    [],
  );
  assert.deepEqual(
    await runRule('py/tautological-assert', 'def f(x):\n    assert x > x\n', 'python'),
    [],
  );
});

test('py/stub-body flags placeholder bodies', async () => {
  const bodies = [
    'def f():\n    pass\n',
    'def f():\n    """doc"""\n    ...\n',
    'def f():\n    return None\n',
    'def f():\n    raise NotImplementedError()\n',
  ];
  for (const source of bodies) {
    const drafts = await runRule('py/stub-body', source, 'python');
    assert.equal(drafts.length, 1, source);
  }
});

test('py/stub-body treats a decorated top-level function as module-level', async () => {
  const drafts = await runRule(
    'py/stub-body',
    ['@app.get("/users")', 'def list_users():', '    pass'].join('\n'),
    'python',
  );
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'high');
});

test('py/stub-body ignores abstract, protocol, dunder and real bodies', async () => {
  const abstract = [
    'from abc import abstractmethod',
    '',
    'class Base:',
    '    @abstractmethod',
    '    def run(self):',
    '        pass',
  ].join('\n');
  assert.deepEqual(await runRule('py/stub-body', abstract, 'python'), []);

  const protocol = ['from typing import Protocol', '', 'class P(Protocol):', '    def run(self) -> None:', '        ...'].join('\n');
  assert.deepEqual(await runRule('py/stub-body', protocol, 'python'), []);

  assert.deepEqual(await runRule('py/stub-body', 'def __init__(self):\n    pass\n', 'python'), []);
  assert.deepEqual(await runRule('py/stub-body', 'def f():\n    return 1\n', 'python'), []);
});

test('py/stub-body does not double-report test functions', async () => {
  assert.deepEqual(await runRule('py/stub-body', 'def test_x():\n    pass\n', 'python'), []);
});

test('py/swallowed-exception flags silent handlers', async () => {
  const source = ['try:', '    work()', 'except Exception:', '    pass'].join('\n');
  const drafts = await runRule('py/swallowed-exception', source, 'python');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'high');
});

test('py/swallowed-exception lowers confidence when a comment explains it', async () => {
  const source = ['try:', '    work()', 'except Exception:', '    # best effort', '    pass'].join('\n');
  const drafts = await runRule('py/swallowed-exception', source, 'python');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'medium');
});

test('py/swallowed-exception ignores handlers that log', async () => {
  const source = ['try:', '    work()', 'except Exception as exc:', '    logger.warning("failed: %s", exc)'].join('\n');
  assert.deepEqual(await runRule('py/swallowed-exception', source, 'python'), []);
});

test('py/dead-branch flags constant conditions but keeps while True', async () => {
  assert.equal((await runRule('py/dead-branch', 'if False:\n    x = 1\n', 'python')).length, 1);
  assert.equal((await runRule('py/dead-branch', 'if True:\n    x = 1\n', 'python'))[0]?.confidence, 'medium');
  assert.deepEqual(await runRule('py/dead-branch', 'while True:\n    pass\n', 'python'), []);
  assert.deepEqual(await runRule('py/dead-branch', 'def f(flag):\n    if flag:\n        x = 1\n', 'python'), []);
});

test('py/noop-test skips pytest skip markers and pytest.skip calls', async () => {
  for (const source of [
    '@pytest.mark.skip(reason="later")\ndef test_later():\n    pass\n',
    'def test_later():\n    pytest.skip("later")\n',
  ]) {
    assert.deepEqual(await runRule('py/noop-test', source, 'python'), [], source);
  }
});

test('py/dead-branch handles elif and parenthesized constants', async () => {
  assert.equal(
    (await runRule('py/dead-branch', 'if True:\n    pass\nelif False:\n    pass\n', 'python')).some(
      (draft) => /elif|dead/.test(draft.message),
    ),
    true,
  );
  assert.equal(
    (await runRule('py/dead-branch', 'if (False):\n    run()\n', 'python')).length,
    1,
  );
  assert.equal(
    (await runRule('py/dead-branch', 'if True:\n    import os\n', 'python')).length,
    1,
  );
});

test('py/phantom-import ignores ImportError text outside the handler type', async () => {
  const source = [
    'try:',
    '    import missing_dependency',
    'except Exception:',
    '    print("do not raise ImportError here")',
    '',
  ].join('\n');
  const drafts = await runRule('py/phantom-import', source, 'python', makeDeps({ pythonManifests: ['pyproject.toml'] }));
  assert.equal(drafts.length, 1);
});

test('py/phantom-import accepts ImportError anywhere in a tuple handler', async () => {
  for (const handler of ['except (ValueError, ImportError):', 'except (ImportError, ValueError):']) {
    const source = [
      'try:',
      '    import optional_dependency',
      handler,
      '    optional_dependency = None',
      '',
    ].join('\n');
    assert.deepEqual(
      await runRule(
        'py/phantom-import',
        source,
        'python',
        makeDeps({ pythonManifests: ['pyproject.toml'] }),
      ),
      [],
      handler,
    );
  }
});

test('py/phantom-import accepts a real ImportError optional import', async () => {
  const source = [
    'try:',
    '    import optional_dependency',
    'except ImportError:',
    '    optional_dependency = None',
    '',
  ].join('\n');
  const drafts = await runRule('py/phantom-import', source, 'python', makeDeps({ pythonManifests: ['pyproject.toml'] }));
  assert.deepEqual(drafts, []);
});

test('py/unreachable flags statements after exits', async () => {
  assert.equal((await runRule('py/unreachable', 'def f():\n    return 1\n    x = 2\n', 'python')).length, 1);
  assert.equal((await runRule('py/unreachable', 'def f():\n    raise RuntimeError()\n    x = 2\n', 'python')).length, 1);
  assert.deepEqual(await runRule('py/unreachable', 'def f():\n    return 1\n', 'python'), []);
});

test('py/phantom-import ignores private C-extension modules and __main__', async () => {
  const source = ['import _socket', 'import _winapi', 'import __main__'].join('\n');
  assert.deepEqual(await runRule('py/phantom-import', source, 'python'), []);
});

test('py/stub-body: methods and private functions are only medium confidence', async () => {
  const method = await runRule('py/stub-body', 'class A:\n    def run(self):\n        pass\n', 'python');
  assert.equal(method[0]?.confidence, 'medium');

  const privateFn = await runRule('py/stub-body', 'def _f():\n    pass\n', 'python');
  assert.equal(privateFn[0]?.confidence, 'medium');

  const documented = await runRule('py/stub-body', 'def f():\n    """Do it."""\n    pass\n', 'python');
  assert.equal(documented[0]?.confidence, 'medium');

  const publicFn = await runRule('py/stub-body', 'def f():\n    pass\n', 'python');
  assert.equal(publicFn[0]?.confidence, 'high');
});

test('py/stub-body skips test files entirely', async () => {
  const source = 'def helper():\n    pass\n';
  assert.deepEqual(await runRuleOnFile('py/stub-body', source, 'python', 'tests/test_app.py'), []);
  const inApp = await runRuleOnFile('py/stub-body', source, 'python', 'app.py');
  assert.equal(inApp.length, 1);
});

test('py/noop-test skips demo code under __main__ guards', async () => {
  const source = ['if __name__ == "__main__":', '    def test_demo():', '        run_demo()'].join('\n');
  assert.deepEqual(await runRuleOnFile('py/noop-test', source, 'python', 'tests/test_demo.py'), []);
});

test('py/noop-test lowers confidence when the test delegates to self helpers', async () => {
  const source = [
    'class TestThing:',
    '    def test_log(self):',
    '        self._test_log("log", 1)',
  ].join('\n');
  const drafts = await runRuleOnFile('py/noop-test', source, 'python', 'tests/test_thing.py');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'medium');
});

test('py/swallowed-exception lowers confidence for specific exception types', async () => {
  const source = ['try:', '    close()', 'except OSError:', '    pass'].join('\n');
  const drafts = await runRule('py/swallowed-exception', source, 'python');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.confidence, 'medium');
});

test('py/swallowed-exception skips optional-import and assertion idioms', async () => {
  const optionalImport = ['try:', '    import ujson', 'except ImportError:', '    pass'].join('\n');
  assert.deepEqual(await runRule('py/swallowed-exception', optionalImport, 'python'), []);

  const assertionIdiom = [
    'try:',
    '    value = obj.attr',
    'except AttributeError:',
    '    pass',
    'else:',
    '    raise AssertionError("should not have an attribute")',
  ].join('\n');
  assert.deepEqual(await runRule('py/swallowed-exception', assertionIdiom, 'python'), []);
});

test('py/swallowed-exception skips test files', async () => {
  const source = ['try:', '    go()', 'except Exception:', '    pass'].join('\n');
  assert.deepEqual(await runRuleOnFile('py/swallowed-exception', source, 'python', 'tests/test_app.py'), []);
});

test('py/dead-branch skips test files and abstract method stubs', async () => {
  assert.deepEqual(await runRuleOnFile('py/dead-branch', 'if False:\n    x = 1\n', 'python', 'test_app.py'), []);

  const abstract = [
    'from abc import abstractmethod',
    'class Base:',
    '    @abstractmethod',
    '    def __iter__(self):',
    '        while False:',
    '            yield None',
  ].join('\n');
  assert.deepEqual(await runRule('py/dead-branch', abstract, 'python'), []);
});

test('py/unreachable skips test files', async () => {
  const source = 'def f():\n    return 1\n    x = 2\n';
  assert.deepEqual(await runRuleOnFile('py/unreachable', source, 'python', 'tests/test_app.py'), []);
});
