#!/usr/bin/env node
/**
 * Points the project at its real GitHub repository.
 *
 *   node scripts/set-repo.mjs https://github.com/owner/repo --write
 *   node scripts/set-repo.mjs --self-test
 *
 * Replaces the placeholder `slopgate/slopgate` slug everywhere, and rewrites
 * relative links in README.md to absolute URLs. Absolute links matter because
 * npm renders the README on npmjs.com, where relative paths do not resolve.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLACEHOLDER = 'slopgate/slopgate';
const BRANCH = 'main';

const FILES_WITH_SLUG = [
  'package.json',
  'README.md',
  'CONTRIBUTING.md',
  'src/cli.ts',
  'src/reporters/sarif.ts',
];

export function rewriteMarkdownLinks(markdown, repoUrl, branch = BRANCH) {
  const base = repoUrl.replace(/\/+$/, '');
  const raw = base.replace('https://github.com/', 'https://raw.githubusercontent.com/');
  return markdown.replace(
    /(!?)\[([^\]]*)]\(([^)\s]+)(\s+"[^"]*")?\)/g,
    (match, bang, text, target, title = '') => {
      if (/^(https?:|mailto:|#)/.test(target)) return match;
      const [pathPart, hash = ''] = target.split('#');
      const isDirectory = pathPart.endsWith('/');
      const clean = pathPart.replace(/^\.\//, '').replace(/\/+$/, '');
      if (clean.length === 0) return match;
      const url = bang
        ? `${raw}/${branch}/${clean}`
        : isDirectory
          ? `${base}/tree/${branch}/${clean}`
          : `${base}/blob/${branch}/${clean}`;
      const suffix = hash ? `#${hash}` : '';
      return `${bang}[${text}](${url}${suffix}${title})`;
    },
  );
}

function parseArgs(argv) {
  if (argv.includes('--self-test')) return { selfTest: true };
  const args = argv.filter((arg) => arg !== '--write');
  const repoUrl = args[0];
  if (!repoUrl || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(repoUrl)) {
    throw new Error('usage: node scripts/set-repo.mjs https://github.com/owner/repo [--write]');
  }
  return { repoUrl: repoUrl.replace(/\/+$/, ''), write: argv.includes('--write'), branch: BRANCH };
}

function selfTest() {
  const cases = [
    ['[docs](docs/rules.md)', '[docs](https://github.com/o/r/blob/main/docs/rules.md)'],
    ['[bench](benchmark/)', '[bench](https://github.com/o/r/tree/main/benchmark)'],
    [
      '![demo](docs/demo.gif)',
      '![demo](https://raw.githubusercontent.com/o/r/main/docs/demo.gif)',
    ],
    ['[ext](https://example.com/x)', '[ext](https://example.com/x)'],
    ['[anchor](#install)', '[anchor](#install)'],
    ['[h](docs/rules.md#rules)', '[h](https://github.com/o/r/blob/main/docs/rules.md#rules)'],
  ];
  for (const [input, expected] of cases) {
    const actual = rewriteMarkdownLinks(input, 'https://github.com/o/r');
    if (actual !== expected) {
      console.error(`self-test failed\n  input:    ${input}\n  expected: ${expected}\n  actual:   ${actual}`);
      process.exit(1);
    }
  }
  console.log(`set-repo self-test: ${cases.length} cases pass`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) return selfTest();

  const { repoUrl, write } = options;
  const slug = repoUrl.replace('https://github.com/', '');
  let total = 0;

  for (const relative of FILES_WITH_SLUG) {
    const file = path.join(ROOT, relative);
    const original = readFileSync(file, 'utf8');
    let updated = original.split(PLACEHOLDER).join(slug);
    if (relative === 'README.md') updated = rewriteMarkdownLinks(updated, repoUrl);
    const changes = updated === original ? 0 : (updated.match(new RegExp(slug.replace(/[/.]/g, '\\$&'), 'g')) ?? []).length;
    total += changes;
    if (updated === original) continue;
    if (write) {
      writeFileSync(file, updated, 'utf8');
      console.log(`updated ${relative}`);
    } else {
      console.log(`would update ${relative} (${changes} reference(s))`);
    }
  }

  if (total === 0) {
    console.log(`No placeholder references left. Repository is already set to ${slug}.`);
  } else if (!write) {
    console.log(`\n${total} replacement(s) planned. Re-run with --write to apply.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`set-repo: ${error.message}`);
    process.exit(2);
  }
}
