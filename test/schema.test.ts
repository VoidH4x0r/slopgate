import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { normalizeConfig } from '../src/config.ts';
import { ROOT } from './helpers.ts';

test('config JSON schema covers every accepted config field', async () => {
  const schema = JSON.parse(
    await readFile(path.join(ROOT, 'schema', 'slopgate.schema.json'), 'utf8'),
  ) as {
    additionalProperties: boolean;
    properties: Record<string, unknown>;
  };
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    ['$schema', 'confidence', 'exclude', 'failOn', 'ignoreModules', 'include', 'rules'],
  );
  assert.doesNotThrow(() => normalizeConfig({ $schema: schemaId(), include: ['**/*.go'] }));
});

function schemaId(): string {
  return 'https://example.test/slopgate.schema.json';
}
