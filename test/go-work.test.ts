import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { scanProject } from '../src/engine.ts';

test('go.work modules are accepted as local workspace imports', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopgate-gowork-'));
  try {
    await mkdir(path.join(dir, 'a'), { recursive: true });
    await mkdir(path.join(dir, 'b', 'pkg'), { recursive: true });
    await writeFile(path.join(dir, 'go.work'), 'go 1.24\n\nuse (\n\t./a\n\t./b\n)\n', 'utf8');
    await writeFile(path.join(dir, 'a', 'go.mod'), 'module example.com/a\n\ngo 1.24\n', 'utf8');
    await writeFile(
      path.join(dir, 'b', 'go.mod'),
      'module example.com/b\n\ngo 1.24\n\nrequire github.com/lib/pq v1.10.9\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'a', 'main.go'),
      'package main\n\nimport (\n  "example.com/b/pkg"\n  "github.com/lib/pq"\n)\n\nfunc main() { pkg.Run(); _ = pq.ErrChannelAlreadyOpen }\n',
      'utf8',
    );
    await writeFile(path.join(dir, 'b', 'pkg', 'pkg.go'), 'package pkg\n\nfunc Run() {}\n', 'utf8');
    const result = await scanProject({
      root: path.join(dir, 'a'),
      config: { ...DEFAULT_CONFIG, include: ['**/*.go'], exclude: [] },
    });
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === 'go/phantom-import'),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
