# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Duplicate-block detection across files.
- Go and Rust grammars.
- VS Code diagnostics.

### Changed
- The README now leads with what the defects cost, documents `.slopgate.json`, lists exit codes, and explains the scoped npm name.
- The demo GIF is rendered at 1440px with vectorised monospace text instead of a blurry 720px raster.
- The npm package is published as `@voidh4x0r/slopgate`: npm rejects the unscoped name as too similar to the existing `slop-gate` package. The CLI command remains `slopgate`.

## [0.1.0] - 2026-11-22

### Added
- 14 AST-based rules:
  - Python: `phantom-import`, `noop-test`, `tautological-assert`, `stub-body`, `swallowed-exception`, `dead-branch`, `unreachable`
  - TypeScript/JavaScript: `phantom-import`, `noop-test`, `tautological-assert`, `stub-function`, `swallowed-exception`, `dead-branch`, `unreachable`
- Confidence tiers (`high` / `medium` / `low`) with machine-readable evidence for every finding. Only `high` is shown by default and fails CI.
- Dependency awareness: `pyproject.toml`, `requirements*.txt`, `setup.py`, `setup.cfg`, `Pipfile`, `package.json`, `tsconfig` path aliases, npm workspaces, installed `node_modules`.
- CLI with `pretty`, `json`, `sarif` and `github` output, stable exit codes, and `--fail-on` thresholds.
- `--format github` emits GitHub Actions workflow-command annotations, so findings appear inline on a pull request without code scanning.
- Adoption tools: `--write-baseline` + `.slopgate-baseline.json`, and `--diff <ref>` for pull-request-only scanning.
- Inline suppression: `slopgate-ignore-next-line`, `slopgate-ignore-line`, `slopgate-disable-file` — only honoured inside real comments.
- `slopgate init` writes a config file and a GitHub Actions workflow.
- MCP server (`slopgate mcp`) with `scan_diff`, `scan_path` and `list_rules` tools, so coding agents can lint their own changes before finishing. Respects `.slopgate.json` and the baseline.
- Bundled tree-sitter WASM grammars for Python, TypeScript and TSX; no Python or TypeScript toolchain needed at scan time.
- Reproducible precision benchmark: `scripts/benchmark.mjs`, `benchmark/labels.json`, `benchmark/report.md`.
- Animated terminal demo GIF (`docs/demo.gif`) generated from `scripts/demo-frame.mjs` by `scripts/make-demo-gif.mjs` (optional `sharp` + `gifenc`).
- `scripts/check-links.mjs` verifies every relative markdown link in CI.
- `slopgate path/to/file.py` scans a single file instead of walking its parent directory.
- 136 tests, including negative tests for every rule.

### Changed
- Default `--confidence` is now `high`; medium findings are opt-in.
- Precision pass against 991,705 lines of CPython: high findings reduced from 10,000 to 35 (91.4% labeled precision), 14/14 seeded defects still detected. A second corpus of 601 JavaScript files produces 0 high findings.
- Rules skip test files where the scaffolding is intentional (`dead-branch`, `unreachable`, `stub-body`, `swallowed-exception`, `phantom-import` handles them at medium confidence instead).
- Findings in files with syntax errors are demoted to `medium`.
- `ts/swallowed-exception` reports `medium` by design: empty `catch` is idiomatic JavaScript.
- `ts/stub-function` reports an empty body at `medium`; only an explicit `throw new Error("not implemented")` is `high`. No-op conventions (`noop`, `noOp`, `ignore`) and `@abstract` JSDoc are skipped.
- `ts/phantom-import` ignores URL specifiers (`https://…`), optional `require` calls inside `try`, and asset imports.
- `py/noop-test` is restricted to real test modules and test classes, and lowers confidence for likely helper functions.
- Config, manifests and baselines tolerate a UTF-8 BOM (common on Windows).
- `--diff` handles file names containing spaces or non-ASCII characters, and scans started from a subdirectory of the repository.
- `--diff` rejects refs that look like git options (for example `--output=file`) instead of passing them through.
- `--baseline` records how many findings share a fingerprint, so a newly added identical finding is still reported; older baselines without the count keep working.
- Passing more than one path exits 2 instead of silently scanning only the first one.
- A missing path or an unknown `--rule` id exits 2 with a message instead of silently reporting nothing.
- `slopgate init` writes a four-key config instead of a full dump of defaults.
- The published tarball no longer ships the demo GIF (the README uses an absolute raw URL after `scripts/set-repo.mjs`).
- The CLI accepts an injected output writer (`main(argv, io)`), so tests no longer replace `process.stdout`. Replacing it corrupted Node's test-runner protocol in CI, which made one test fail and hid 16 others.
- An explicitly requested `--baseline` file that does not exist now exits 2 instead of silently disabling the baseline.
- Scanning zero files prints a warning (empty `include` list, wrong path, or everything ignored).
- `slopgate mcp` refuses a root that is not a directory, and `scan_path` refuses symlinks that escape the repository.
- `slopgate init` creates the target directory when it does not exist.

