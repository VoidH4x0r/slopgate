import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONFIG,
  findConfigRoot,
  loadConfig,
  meetsConfidence,
  normalizeConfig,
} from '../src/config.ts';

test('normalizeConfig returns defaults for an empty object', () => {
  const config = normalizeConfig({});
  assert.deepEqual(config.exclude, []);
  assert.deepEqual(config.rules, {});
  assert.equal(config.confidence, DEFAULT_CONFIG.confidence);
  assert.equal(config.failOn, DEFAULT_CONFIG.failOn);
  assert.ok(config.include.includes('**/*.py'));
});

test('normalizeConfig accepts rule severities and "off"', () => {
  const config = normalizeConfig({ rules: { 'py/noop-test': 'off', 'ts/stub-function': 'error' } });
  assert.equal(config.rules['py/noop-test'], 'off');
  assert.equal(config.rules['ts/stub-function'], 'error');
});

test('normalizeConfig rejects values inherited from Object.prototype', () => {
  for (const value of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    assert.throws(() => normalizeConfig({ confidence: value }), /confidence/);
  }
});

test('normalizeConfig accepts and ignores a $schema meta key', () => {
  const config = normalizeConfig({ $schema: 'https://example.test/slopgate.schema.json' });
  assert.equal(config.confidence, DEFAULT_CONFIG.confidence);
  assert.throws(() => normalizeConfig({ typo: true }), /unknown config field "typo"/);
});

test('normalizeConfig rejects invalid values', () => {
  assert.throws(() => normalizeConfig({ confidence: 'certain' }), /confidence/);
  assert.throws(() => normalizeConfig({ rules: { 'py/noop-test': 'loud' } }), /must be/);
  assert.throws(() => normalizeConfig({ include: 'not-an-array' }), /array of strings/);
  assert.throws(() => normalizeConfig({ failOn: 'sometimes' }), /failOn/);
  assert.throws(() => normalizeConfig({ typo: true }), /unknown config field "typo"/);
  assert.throws(() => normalizeConfig([]), /JSON object/);
});

test('meetsConfidence compares ranks', () => {
  assert.ok(meetsConfidence('high', 'medium'));
  assert.ok(meetsConfidence('medium', 'medium'));
  assert.ok(!meetsConfidence('low', 'medium'));
  assert.ok(meetsConfidence('low', 'low'));
});

test('loadConfig falls back to defaults when no config file exists', async () => {
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'demo');
  const { config, file } = await loadConfig(fixture);
  assert.equal(file, undefined);
  assert.equal(config.failOn, 'high');
});

test('loadConfig tolerates a UTF-8 BOM', async () => {
  const dir = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp-bom-'));
  try {
    await writeFile(path.join(dir, '.slopgate.json'), '\uFEFF{"confidence":"low"}\n', 'utf8');
    const { config, file } = await loadConfig(dir);
    assert.equal(file, '.slopgate.json');
    assert.equal(config.confidence, 'low');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findConfigRoot walks to the boundary without git', async () => {
  const dir = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp-config-root-'));
  try {
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, '.slopgate.json'), '{}\n');
    assert.equal(await findConfigRoot(path.join(dir, 'src'), dir), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
