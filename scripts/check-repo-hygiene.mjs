#!/usr/bin/env node
/**
 * Fail when a tracked file looks like a local secret or build artifact.
 *
 * This is deliberately a high-signal check: it inspects the Git index, not the
 * working tree, so ignored files (node_modules, dist, local tarballs) never
 * become part of the upload surface. It does not try to be a general secret
 * scanner; it prevents the mistakes that are cheap to detect and expensive to
 * publish.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REPORTED = 20;

const FORBIDDEN_PATHS = [
  { name: 'environment file', pattern: /(^|\/)\.env(?:\..*)?$/i },
  { name: 'npm credentials', pattern: /(^|\/)\.npmrc$/i },
  { name: 'netrc credentials', pattern: /(^|\/)\.netrc$/i },
  { name: 'SSH private key', pattern: /(^|\/)id_rsa$/i },
  { name: 'SSH private key', pattern: /(^|\/)id_ed25519$/i },
  {
    name: 'binary or local artifact',
    pattern: /\.(?:pem|key|p12|pfx|vsix|tsbuildinfo|tgz|zip|7z|rar|log|sqlite|db|har)$/i,
  },
];

const CONTENT_RULES = [
  {
    name: 'private key block',
    pattern: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/,
  },
  {
    name: 'GitHub token',
    pattern: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{20,}\b/ },
  { name: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  // Absolute home paths leak the contributor's machine name into a public repo.
  { name: 'Windows home path', pattern: /\b[A-Za-z]:\\Users\\[^\\\r\n]+\\/ },
  { name: 'Unix home path', pattern: /\/(?:home|Users)\/[A-Za-z0-9._-]+\// },
];

function trackedFiles() {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], {
      cwd: ROOT,
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
    });
    return output
      .toString('utf8')
      .split('\0')
      .filter((file) => file.length > 0);
  } catch (error) {
    throw new Error(`repository hygiene requires a Git checkout: ${error.message}`);
  }
}

function isBinary(buffer) {
  return buffer.includes(0);
}

function location(file, source, offset) {
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  return `${file}:${line}`;
}

const findings = [];
const files = trackedFiles();

for (const file of files) {
  const normalized = file.replaceAll('\\', '/');
  const forbidden = FORBIDDEN_PATHS.find((entry) => entry.pattern.test(normalized));
  if (forbidden) {
    findings.push(`${file}: forbidden upload path (${forbidden.name})`);
    if (findings.length >= MAX_REPORTED) break;
    continue;
  }

  let buffer;
  try {
    buffer = readFileSync(path.join(ROOT, file));
  } catch {
    // A tracked file that disappeared from the working tree is unusual but is
    // not a privacy finding; `git status` will report it separately.
    continue;
  }
  if (buffer.length > MAX_BYTES || isBinary(buffer)) continue;
  const source = buffer.toString('utf8');

  for (const rule of CONTENT_RULES) {
    const match = rule.pattern.exec(source);
    if (!match) continue;
    findings.push(`${location(file, source, match.index)}: ${rule.name}`);
    if (findings.length >= MAX_REPORTED) break;
  }
  if (findings.length >= MAX_REPORTED) break;
}

if (findings.length > 0) {
  process.stderr.write('repository hygiene: refusing to publish local artifacts or secrets\n');
  for (const finding of findings) process.stderr.write(`  ${finding}\n`);
  if (findings.length >= MAX_REPORTED) process.stderr.write('  (report capped; fix the first items and rerun)\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`repository hygiene: ${files.length} tracked files OK\n`);
}
