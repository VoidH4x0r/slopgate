# Contributing

Thanks for taking the time. This project has one rule above all others: **a finding must be worth a human's attention.** A new rule that produces one false positive per hundred true positives is a net negative, no matter how clever it is.

## Setup

```bash
git clone https://github.com/VoidH4x0r/slopgate
cd slopgate
npm install
npm test           # 383 tests, ~0.5s, no network, no subprocesses inside the tests
npm run typecheck
npm run verify     # typecheck + links + tests + build + self-scan + package check
npm run build      # emits dist/ used by the published package
```

Node **23.6+** is required to run the test suite from source (native TypeScript execution). On Node 22.8–23.5 the same suite works if you also pass `--experimental-strip-types`. The published CLI itself supports Node 20+. The CI `runtime` jobs run it on Node 20 and 22, but the source test suite only runs on Node 24.

If you are running inside a sandbox that blocks child processes (some agent harnesses do), use:

```bash
npm run test:sandbox
```

It runs the same files with `--test-isolation=none`, in a single process.

## Architecture

```
src/
  cli.ts            argument parsing, exit codes, output selection
  engine.ts         file discovery → parse → run rules → filter → sort
  parser.ts         tree-sitter runtime + bundled grammars (WASM)
  ast.ts            the non-null AST shape every rule sees
  files.ts          walking, ignore defaults, glob matcher
  deps.ts           manifest parsing (Python + Node), alias/workspace resolution
  projects.ts       lazy per-file project registry + local-module index
  config.ts         .slopgate.json schema and defaults
  suppress.ts       slopgate-ignore-* directives
  baseline.ts       stable fingerprints for "new findings only"
  diff.ts           git diff → changed lines
  mcp.ts            Model Context Protocol server (stdio, JSON-RPC)
  rules/
    python.ts       Python file rules
    typescript.ts   TS/JS file rules
    go.ts            Go file rules
    rust.ts          Rust file rules
    duplicates.ts   cross-file duplicate-block rules
    fixes.ts        safe statement-deletion edits
    helpers.ts      shared AST utilities
  fix.ts            atomic safe-fix writer
  reporters/        pretty, json, sarif, github annotations
grammars/           bundled tree-sitter WASM (python, typescript, tsx, go, rust)
fixtures/           small repositories used by the integration tests
```

## Adding a rule

1. Add the rule to `src/rules/python.ts`, `src/rules/typescript.ts`, `src/rules/go.ts` or `src/rules/rust.ts`. Cross-file rules use the `ProjectRule` API in `src/rules/duplicates.ts` and must be registered in `PROJECT_RULES` in `src/rules/index.ts`; `ALL_RULE_METAS` must include every rule for `slopgate rules`, config validation and SARIF.

```ts
const noReturnValue: Rule = {
  meta: {
    id: 'py/no-return-value',
    title: 'Function returns nothing',
    summary: 'One sentence explaining what this catches and why it matters.',
    severity: 'warning',
    confidence: 'high',      // see the policy below
    languages: ['python'],
    tags: ['completeness'],
  },
  run(ctx) {
    if (ctx.language !== 'python') return [];
    const drafts: RuleDraft[] = [];
    // walk ctx.root, push drafts
    return drafts;
  },
};
```

2. Register it in the exported array at the bottom of the file.
3. Add **both** a positive and a negative test to `test/rules-python.test.ts` or `test/rules-typescript.test.ts`. The negative test is the important one.
4. Document it in `docs/rules.md` with a bad example and a good example.
5. If it changes the demo output, update the table in `README.md`.

## Confidence policy

| Level | Use it when |
| --- | --- |
| `high` | The finding states a verifiable fact ("this package is not in the manifest", "this test has no assertion"). A reviewer can confirm it in one glance. |
| `medium` | The fact holds but intent may explain it ("empty catch with a comment", "installed but undeclared dependency"). |
| `low` | You are pattern-matching on style. If you are not sure, do not ship the rule. |

Never raise confidence to make a rule more visible. Lower it, or drop the rule.

## Encoding

Every text file is UTF-8 without a BOM. English docs are the default and may only contain the typographic characters in `scripts/encoding-policy.json`; translations live under `docs/zh/` or use a `.zh*.md` suffix. Run:

```bash
npm run check:encoding
```

See [docs/encoding.md](docs/encoding.md) for the incident analysis, the whitelist policy, and the recovery procedure.

## Tests

- Tests must not touch the network and must not spawn processes; they run in-process in milliseconds.
- CLI tests pass an output collector to `main(argv, io)`; never replace `process.stdout` / `process.stderr`, because Node's test runner uses them for its own protocol when test files run in separate processes.
- Use `runRule(ruleId, source, language, deps)` for unit tests and `scanFixture(name)` for integration tests.
- MCP tools are tested by calling `createMcpServer({...}).handle(line)` with injected `scan`/`diff` functions — see `test/mcp.test.ts`.
- Fixtures live in `fixtures/`; a fixture is a miniature repository with manifests, not just source files.

## Pull requests

- One rule per PR.
- Every rule has a negative test.
- `npm test` and `npm run typecheck` pass, and `node scripts/check-links.mjs` reports no broken links.
- No new runtime dependency without a discussion in an issue first — the offline, no-subprocess-during-scan design is a feature (`git` is only invoked by `--diff` and the MCP `scan_diff` tool).
- Update `CHANGELOG.md`.

## Regenerating the demo GIF

```bash
npm install --no-save sharp gifenc opentype.js
npm run demo:gif          # writes docs/demo.gif and docs/demo-preview.png
```

`sharp`, `gifenc` and `opentype.js` are optional: contributors never need them, and the generated GIF is committed. The text is vectorised with a monospace TTF; the script uses Consolas on Windows and DejaVu Sans Mono on Linux, or the path in `SLOPGATE_DEMO_FONT`.

## Reporting false positives

Open an issue with the smallest source snippet that reproduces it and the rule id. False-positive reports are the most valuable contribution this project can receive; they feed the benchmark.
