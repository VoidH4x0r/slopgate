import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { ROOT } from './helpers.ts';

test('docs: README and the demo artwork pin the package version', async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };
  const readme = await readFile(path.join(ROOT, 'README.md'), 'utf8');
  const references = [...readme.matchAll(/@voidh4x0r\/slopgate@(\d+\.\d+\.\d+)/g)].map(
    (match) => match[1],
  );
  assert.ok(references.length > 0, 'expected at least one scoped npx reference in README');
  for (const reference of references) {
    assert.equal(reference, pkg.version, 'README pins a stale package version');
  }
  assert.ok(readme.includes(`slopgate ${pkg.version}`), 'README demo banner is stale');

  const frame = await readFile(path.join(ROOT, 'scripts', 'demo-frame.mjs'), 'utf8');
  assert.ok(frame.includes(`slopgate ${pkg.version}`), 'demo artwork banner is stale');
});
