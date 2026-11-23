import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { scanProject } from '../src/engine.ts';

test('suppression directives inside string literals are ignored', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-suppress-string-'));
  try {
    await writeFile(
      path.join(dir, 'app.py'),
      'VALUE = "slopgate-disable-file"  # documentation\n\n\ndef stub():\n    pass\n',
      'utf8',
    );
    const result = await scanProject({
      root: dir,
      config: { ...DEFAULT_CONFIG, include: ['**/*.py'], exclude: [] },
    });
    assert.equal(result.suppressedCount, 0);
    assert.equal(
      result.findings.filter((finding) => finding.ruleId === 'py/stub-body').length,
      1,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
