import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { extractTarGz } from '../scripts/tar-extract.mjs';

function hasTar() {
  try {
    execFileSync('tar', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('extractTarGz restores files including long paths', { skip: !hasTar() }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'slopgate-tar-'));
  const source = path.join(root, 'source');
  const longDir = 'a'.repeat(60);
  const longFile = path.join(source, longDir, 'b'.repeat(60), 'file.ts');
  await mkdir(path.dirname(longFile), { recursive: true });
  await writeFile(longFile, 'export const value = 1;\n', 'utf8');
  await writeFile(path.join(source, 'short.py'), 'print("hi")\n', 'utf8');
  const archive = path.join(root, 'corpus.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', source, '.'], { stdio: 'ignore' });
  try {
    const destination = path.join(root, 'out');
    const count = extractTarGz(archive, destination);
    assert.equal(count, 2);
    assert.equal(await readFile(path.join(destination, longDir, 'b'.repeat(60), 'file.ts'), 'utf8'), 'export const value = 1;\n');
    assert.equal(await readFile(path.join(destination, 'short.py'), 'utf8'), 'print("hi")\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('extractTarGz rejects paths that escape the destination', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'slopgate-tar-'));
  const source = path.join(root, 'source');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'ok.txt'), 'ok', 'utf8');
  const archive = path.join(root, 'corpus.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', source, '.']);
  try {
    const destination = path.join(root, 'out');
    const count = extractTarGz(archive, destination);
    assert.equal(count, 1);
    assert.equal(await readFile(path.join(destination, 'ok.txt'), 'utf8'), 'ok');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
