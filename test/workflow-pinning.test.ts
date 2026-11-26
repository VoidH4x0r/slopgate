import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workflows = fileURLToPath(new URL('../.github/workflows/', import.meta.url));

test('every workflow action is pinned to a full commit SHA', () => {
  const files = readdirSync(workflows).filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'));
  assert.ok(files.length > 0, 'expected at least one workflow file');
  const floating: string[] = [];
  for (const file of files) {
    const text = readFileSync(path.join(workflows, file), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/uses:\s+(\S+)/);
      if (!match?.[1]) continue;
      const ref = match[1];
      if (ref.startsWith('./')) continue;
      if (!/@[0-9a-f]{40}$/.test(ref)) floating.push(`${file}: ${ref}`);
    }
  }
  assert.deepEqual(floating, []);
});
