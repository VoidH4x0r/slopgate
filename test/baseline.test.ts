import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  findingFingerprint,
  legacyFindingFingerprint,
  loadBaseline,
  mergeBaseline,
  partitionByBaseline,
  type BaselineFile,
  writeBaseline,
} from '../src/baseline.ts';
import type { Finding } from '../src/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'py/stub-body',
    message: 'function `f` is a stub',
    severity: 'warning',
    confidence: 'high',
    file: 'app.py',
    start: { line: 3, column: 1 },
    end: { line: 3, column: 9 },
    snippet: 'def f(): pass',
    evidence: [],
    ...overrides,
  };
}

test('fingerprint is stable when a finding moves lines but keeps its text', () => {
  const first = makeFinding({ start: { line: 3, column: 1 } });
  const moved = makeFinding({ start: { line: 40, column: 1 } });
  assert.equal(findingFingerprint(first), findingFingerprint(moved));
});

test('fingerprint changes when the source text changes', () => {
  assert.notEqual(
    findingFingerprint(makeFinding()),
    findingFingerprint(makeFinding({ snippet: 'def f(): ...' })),
  );
});

test('fingerprint changes across rules and files', () => {
  assert.notEqual(findingFingerprint(makeFinding()), findingFingerprint(makeFinding({ ruleId: 'py/noop-test' })));
  assert.notEqual(findingFingerprint(makeFinding()), findingFingerprint(makeFinding({ file: 'other.py' })));
});

test('partitionByBaseline separates known findings from new ones', () => {
  const known = makeFinding();
  const fresh = makeFinding({ snippet: 'def g(): pass', ruleId: 'py/noop-test' });
  const baseline: BaselineFile = {
    version: 1,
    createdAt: new Date(0).toISOString(),
    entries: [{ fingerprint: findingFingerprint(known), ruleId: known.ruleId, file: known.file }],
  };
  const partition = partitionByBaseline([known, fresh], baseline);
  assert.deepEqual(partition.known, [known]);
  assert.deepEqual(partition.fresh, [fresh]);
});

test('partitionByBaseline without a baseline keeps everything', () => {
  const partition = partitionByBaseline([makeFinding()], undefined);
  assert.equal(partition.fresh.length, 1);
  assert.equal(partition.known.length, 0);
});

test('partitionByBaseline reports a newly added identical finding', () => {
  const first = makeFinding({ start: { line: 3, column: 1 } });
  const second = makeFinding({ start: { line: 40, column: 1 } });
  const baseline: BaselineFile = {
    version: 1,
    createdAt: new Date(0).toISOString(),
    entries: [{ fingerprint: findingFingerprint(first), ruleId: first.ruleId, file: first.file, count: 1 }],
  };
  const partition = partitionByBaseline([first, second], baseline);
  assert.equal(partition.known.length, 1);
  assert.equal(partition.fresh.length, 1);
  assert.equal(partition.fresh[0], second);
});

test('partitionByBaseline treats a legacy entry without count as one', () => {
  const first = makeFinding();
  const legacy = {
    version: 1 as const,
    createdAt: new Date(0).toISOString(),
    entries: [{ fingerprint: findingFingerprint(first), ruleId: first.ruleId, file: first.file }],
  };
  const partition = partitionByBaseline([first, makeFinding({ start: { line: 40, column: 1 } })], legacy);
  assert.equal(partition.known.length, 1);
  assert.equal(partition.fresh.length, 1);
});

test('writeBaseline stores the count for duplicate fingerprints', async () => {
  const dir = await mkdtemp(path.join(HERE, '.tmp-baseline-'));
  try {
    const file = path.join(dir, 'baseline.json');
    const findings = [
      makeFinding({ start: { line: 3, column: 1 } }),
      makeFinding({ start: { line: 9, column: 1 } }),
    ];
    await writeBaseline(file, findings);
    const parsed = JSON.parse(await readFile(file, 'utf8')) as BaselineFile;
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0]?.count, 2);

    const loaded = await loadBaseline(file);
    assert.equal(loaded?.entries[0]?.count, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergeBaseline preserves entries outside the scanned files and rules', async () => {
  const dir = await mkdtemp(path.join(HERE, '.tmp-baseline-merge-'));
  try {
    const file = path.join(dir, 'baseline.json');
    const root = makeFinding({ file: 'a.py' });
    const src = makeFinding({ file: 'src/b.py' });
    const otherRule = makeFinding({ file: 'src/b.py', ruleId: 'py/noop-test' });
    await writeBaseline(file, [root, src, otherRule]);

    const merged = await mergeBaseline(file, [src], ['src/b.py']);
    assert.deepEqual(
      merged.entries.map((entry) => entry.file).sort(),
      ['a.py', 'src/b.py'],
    );

    await writeBaseline(file, [root, src, otherRule]);
    const ruleScoped = await mergeBaseline(
      file,
      [src],
      ['src/b.py'],
      new Set(['py/stub-body']),
    );
    assert.ok(ruleScoped.entries.some((entry) => entry.ruleId === 'py/noop-test'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fingerprint includes the finding message when snippets share a first line', () => {
  const one = makeFinding({ snippet: 'import {', message: '`ghost-one` is not declared' });
  const two = makeFinding({ snippet: 'import {', message: '`ghost-two` is not declared' });
  assert.notEqual(findingFingerprint(one), findingFingerprint(two));
});

test('mergeBaseline marks preserved v1 entries as legacy and keeps them matching', async () => {
  const dir = await mkdtemp(path.join(HERE, '.tmp-baseline-legacy-'));
  try {
    const file = path.join(dir, 'baseline.json');
    const old = makeFinding({ file: 'old.py' });
    const fresh = makeFinding({ file: 'new.py' });
    const baseline: BaselineFile = {
      version: 1,
      createdAt: new Date(0).toISOString(),
      entries: [
        {
          fingerprint: legacyFindingFingerprint(old),
          ruleId: old.ruleId,
          file: old.file,
        },
      ],
    };
    await writeFile(file, JSON.stringify(baseline), 'utf8');
    const merged = await mergeBaseline(file, [fresh], ['new.py']);
    assert.equal(merged.version, 2);
    assert.equal(merged.entries.find((entry) => entry.file === 'old.py')?.legacy, true);
    assert.equal(partitionByBaseline([old], merged).known.length, 1);
    assert.equal(partitionByBaseline([fresh], merged).known.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadBaseline rejects a malformed file', async () => {
  const dir = await mkdtemp(path.join(HERE, '.tmp-bad-'));
  try {
    const file = path.join(dir, 'bad.json');
    await writeFile(file, '{"version":99,"entries":[]}', 'utf8');
    await assert.rejects(() => loadBaseline(file), /not a valid baseline/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
