import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';
import { scanProject, CONTRACT_VERSION, ALL_RULE_METAS } from '../src/index.ts';
import { FIXTURES } from './helpers.ts';

test('public API exports a usable scanProject and contract version', async () => {
  assert.equal(CONTRACT_VERSION, 1);
  assert.ok(ALL_RULE_METAS.length >= 32);
  const result = await scanProject({
    root: path.join(FIXTURES, 'demo'),
    config: {
      include: ['**/*.py'],
      exclude: [],
      ignoreModules: [],
      rules: {},
      confidence: 'high',
      failOn: 'high',
    },
  });
  assert.ok(result.files.length > 0);
  assert.ok(Array.isArray(result.findings));
});
