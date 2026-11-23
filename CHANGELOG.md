# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `docs/roadmap.md`: release plan through 1.0, priority order, acceptance gates, metrics, risks and next actions.

### Changed
- Added an explicit encoding contract (`docs/encoding.md`, `scripts/encoding-policy.json`, `scripts/check-encoding.mjs`, `.editorconfig`) enforced by `npm run verify` and CI on Linux and Windows.
- Replaced content-based CJK density/run heuristics with a path-based localization policy and a reviewed non-ASCII whitelist for English docs.

## [0.2.9] - 2026-11-23

### Fixed
- `hasAsciiRoadRun` now inspects only the current line, so an English line ending followed by a Chinese line containing U+8DEF repetitions is not treated as ASCII context.
- Lines containing other CJK characters are treated as Chinese prose, so a Chinese prose line with U+8DEF repetitions and a numeric suffix no longer false-positives.

### Changed
- 343 tests.
- Benchmark high count remains **43 / 97.7% (42/43) / 30/30 seeded**.

## [0.2.8] - 2026-11-23

### Fixed
- `isCjkDocument` now uses CJK density plus the share of lines containing CJK, so an English document with a single four-character Chinese phrase is not treated as a Chinese document.
- Fenced code blocks are excluded from the CJK density calculation, so a Chinese README with large code samples is still recognized as Chinese.
- Repeated U+8DEF runs are rejected only with ASCII context; short Chinese text no longer false-positives, while ASCII-context repetitions still do.

### Changed
- 343 tests.
- Benchmark high count remains **43 / 97.7% (42/43) / 30/30 seeded**.

## [0.2.7] - 2026-11-23

### Fixed
- The encoding guard now checks every 4+ CJK run: any run containing a known mojibake marker rejects the document, even when an earlier run is clean.
- Repeated `U+8DEF` runs (including whitespace-separated runs) in non-Chinese documents are rejected as `·` mojibake; legitimate Chinese prose examples still pass.

### Changed
- 343 tests.
- Benchmark high count remains **43 / 97.7% (42/43) / 30/30 seeded**.

## [0.2.6] - 2026-11-23

### Fixed
- `isCjkDocument` no longer treats a four-character run of known mojibake markers as evidence of a Chinese document, and no longer requires a 2% CJK ratio (which code-heavy Chinese documents could miss).
- Guard regression: four consecutive U+9225 marker characters are reported as GBK/CP936 mojibake.

### Changed
- 343 tests.
- Benchmark high count remains **43 / 97.7% (42/43) / 30/30 seeded**.

## [0.2.5] - 2026-11-23

### Fixed
- `.slopgate.json` accepts and ignores the standard `$schema` meta key while still rejecting genuinely unknown fields.
- Markdown encoding detection now requires a continuous CJK run (four or more characters), so five isolated mojibake characters cannot masquerade as a Chinese document.

### Changed
- 343 tests.
- Benchmark high count remains **43 / 97.7% (42/43) / 30/30 seeded**.

## [0.2.4] - 2026-11-23

### Fixed
- Unknown `.slopgate.json` keys are rejected with exit 2 instead of being silently ignored.
- `import usb` maps to the `pyusb` distribution, avoiding a phantom-import false positive.
- The markdown encoding guard is language-aware: Chinese documents may contain legitimate `U+8DEF` and rare CJK characters, while English documents still reject known mojibake.
- Added `--fix` coverage for `--confidence`, `--verbose`, and read-only `--fix-dry-run`.

### Changed
- 342 tests.
- Benchmark high count remains **43 / 97.7% (42/43) / 30/30 seeded**.

## [0.2.3] - 2026-11-23

### Fixed
- Restored UTF-8 clean `README.md`, `CHANGELOG.md` and `CONTRIBUTING.md` after a double-decoded docs edit; no CJK mojibake or replacement characters remain.
- Added a markdown encoding guard that rejects `U+FFFD`, known GBK/CP936 mojibake markers, and common Latin-1 mojibake while allowing legitimate CJK text.

### Changed
- 339 tests.

## [0.2.2] - 2026-11-23

### Fixed
- `duplicate-block` signatures include anonymous AST tokens (operators and punctuation); `+=` vs `-=`, `*` vs `/` and `<` vs `>` no longer match.
- A duplicate group reports at most one representative per file; nested helpers are suppressed only when an enclosing function is itself in a duplicate group.
- SARIF now uses `ALL_RULE_BY_ID`, so duplicate rules carry title, summary and tags.
- `--fix` records a BOM-stripped source hash and refuses to apply stale offsets if the file changed between scan and write.

### Changed
- 338 tests.
- README performance section updated to the measured ~13 s CPython benchmark and documents the duplicate-block opt-out for large repositories.
- Benchmark high count remains **43 / 97.7% (42/43) / 30/30 seeded**; the duplicate medium count changed.

## [0.2.1] - 2026-11-22

### Added
- `py/duplicate-block` and `ts/duplicate-block`: exact normalized function/method bodies duplicated across files, at medium confidence. Bodies must span at least 6 lines and 15 leaf tokens; test files, same-file copies and parse-error files are skipped.
- `slopgate --fix` / `--fix-dry-run` for the safe subset: unreachable statements after `return` / `raise` / `break` / `continue`. Fixes are atomic, preserve BOM/CRLF, respect baseline/diff/confidence/rule filters, and are followed by a re-scan.
- `fixtures/ai-generated`: 20-file AI-generated regression corpus with provenance, 32 labeled high-confidence fingerprints and 30/30 seeded recall.

### Changed
- 327 tests.
- Benchmark: **43 high-confidence findings** across 1,115,270 lines, **97.7% labeled precision (42/43)**, **30/30 seeded defects**, 0 high findings on 601 JavaScript files.
- `slopgate rules` now lists 16 rules.

### Planned
- Go and Rust grammars.
- VS Code diagnostics.
- Semantic clone detection beyond exact normalized bodies.

## [0.2.0] - 2026-11-22

### Fixed
- Config `include` / `exclude` globs are matched relative to the config file's directory (or the project root when no config exists), so a root config still governs `slopgate backend` and CLI `--exclude generated/**` works without a config file.
- Registry indexing is scoped to the repository/target, lazy-loads project deps, caches project/non-project ancestor checks, and respects `config.exclude`; MCP rebuilds the index per call so new modules and projects are visible, while configs invalidate on mtime. Non-git scans use a lookup boundary for ancestor manifests and bounded-recursion Python top-level modules (including namespace packages without `__init__.py`) between the package and cwd; this intentionally trades some precision for fewer false positives when a Python-bearing sibling exists above the project.
- Python namespace-package discovery for non-git ancestor modules follows valid package segments up to 5 levels, so `lib/a/b/c/d/module.py` without `__init__.py` is seen from a workspace cwd.
- Python files choose the nearest **Python** manifest rather than a nested Node-only `package.json`; TS files use the nearest `package.json`; indexes cover ancestor manifests and sibling modules.
- Python project markers are derived from the same list as `PYTHON_MANIFESTS` (`requirements-dev.txt`, `environment.yml`, etc.).
- `pytest.warns` / `pytest.deprecated_call` count as assertions, but a plain `warnings.warn()` does not.
- Top-level decorated `pass`/`...` functions remain high-confidence stubs.
- `ts/tautological-assert` no longer treats two calls with the same text as identical.
- `ts/stub-function` recognises `unimplemented` / `Not yet implemented` placeholders.
- Suppression directives inside block comments and before decorators now reach the finding.
- Disabled tests (`test.skip` / `todo` / `fixme`, `xdescribe`/`xcontext`/`xsuite`, including inside `describe.skip`) are skipped; Cypress/Playwright implicit commands demote assertion-free tests to medium.
- `--write-baseline` merges the scanned scope into the root baseline instead of clobbering entries outside it; writes are atomic.
- Empty `--include=`, `--exclude=`, `--rule=`, `--baseline=` and `--write-baseline=` values are rejected; `--diff=` falls back to HEAD.
- Error help paths show the actual package version; `--verbose` docs describe the config/diff details it actually prints.
- `isInDiffWithPrefix` checks the prefixed path before any raw path, avoiding false root-file matches.
- Root scans now resolve dependencies per file: monorepo files use their nearest `pyproject.toml` / `package.json` / requirements file, and Python local-module discovery covers the whole repository rather than only scanned files.
- Non-git scans search parent manifests/configs up to the current working directory boundary while keeping report paths relative to the scan target.
- Vite/TypeScript aliases now come from `tsconfig.app.json`, `tsconfig.node.json`, `jsconfig.json`, `extends`, and project references; `@/`, `~/`, `$lib/`, `$app/`, `$env/`, `npm:` and `jsr:` prefixes are treated as virtual.
- Findings are computed once relative to an explicit report root; CLI/MCP/baseline/diff no longer re-prefix target-relative paths.
- Single-file and subdirectory scans now resolve the nearest project root for manifests, aliases and same-package local modules; output and `--diff` paths use the target directory prefix.
- Namespace distributions such as `google-cloud-storage`, `opentelemetry-api`, `azure-storage-blob`, `ruamel.yaml`, `backports.zoneinfo` and headless OpenCV satisfy their import names.
- `py/tautological-assert` no longer treats two independent calls (`parse("x") == parse("x")`) as identical, while deterministic attribute/subscript expressions still count.
- A mistyped rule id in a suppression directive no longer falls back to suppressing the whole line.
- pnpm/npm-link symlinks under `node_modules` count as installed packages.
- `requirements.in` and `environment.yml` dependency declarations are parsed.
- A `tsconfig.json` `baseUrl` contributes import aliases.
- `slopgate --help` reports the actual package version instead of the fallback.

## [0.1.18] - 2026-11-22

### Changed
- README “Auditing AI-written code” now states the scope of the medium threshold: `pass` / `...` / `throw not implemented` stubs are covered; a bare `return None` is `low`, while `return []` / `{}` / `""` / `False` and empty classes are not reported because they are indistinguishable from legitimate default returns.
- `--strict` on a scan/rules/MCP command prints a stderr hint that it only affects `init` and points to `--confidence medium`; behavior is otherwise unchanged.

### Tests
- 272 tests, including the `--strict` misuse warning.
- Benchmark unchanged at **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.

## [0.1.17] - 2026-11-22

### Added
- `slopgate init --strict` writes `confidence: "medium"` and `failOn: "medium"` into `.slopgate.json` and generates a workflow with `--confidence medium --fail-on medium`, matching the AI-code audit recipe. Default `init` remains high/high for human-maintained repositories.
- README “Auditing AI-written code” section with the baseline-first medium recipe, explaining that implementation stubs are medium by design while test theatre is high.
- `py/stub-body` and `ts/stub-function` docs now state that most real AI-stub findings are at medium confidence.

### Changed
- 271 tests, including `init --strict` config and workflow assertions.
- Benchmark unchanged at **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.

## [0.1.16] - 2026-11-22

### Fixed
- `py/swallowed-exception` classifies the caught type independently of an `as name` binding: `except Exception as error:`, `except BaseException as e:`, `except (Exception,) as e:` and `except* Exception as e:` are high confidence again, with the broad “swallows the error” message instead of “specific error type”.
- Tuples containing `Exception`/`BaseException` are treated as broad; `(ValueError, RuntimeError)` remains specific/medium.

### Changed
- 270 tests, including `as-binding` and `as-binding-more` fixtures covering bindings, `except*`, single-element and mixed tuples.
- Docs note that human-written benchmark corpora rarely exercise AI-specific `except … as e: pass` shapes; regression fixtures cover them until the AI corpus.
- Benchmark unchanged at **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.

## [0.1.15] - 2026-11-22

### Fixed
- MCP `scan_path` now normalizes findings to MCP-root-relative paths inside `defaultMcpDeps.scan` before applying the root baseline, so a baseline written by `slopgate . --write-baseline` suppresses findings for subdirectory and single-file scans too. `scan_diff` is unchanged because it scans the root (empty prefix).
- Removed the duplicate path prefixing from `scan_path`; normalization has one owner and cannot double-prefix.

### Changed
- 267 tests, including root-baseline suppression for MCP directory/file/root scans and no-double-prefix coverage.
- Documented that the MCP server root must be the repository root; select subdirectories with `scan_path`.
- Benchmark unchanged at **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.

## [0.1.14] - 2026-11-22

### Fixed
- MCP `scan_path` resolves config for the requested target with the same nearest-config search as the CLI (package config wins, root config falls back). Configs are cached per resolved config root.
- MCP findings are reported relative to the MCP server root (`packages/app/app.py`), not relative to the scan target (`app.py`).
- MCP uses the target config’s `confidence` as the default when a call omits `confidence`.
- `findGitRoot` / `hasConfig` / `findConfigRoot` moved from `cli.ts` to `config.ts`, shared by CLI and MCP.

### Changed
- 266 tests, including MCP package-vs-root config parity, root-relative paths, and target-confidence behavior.
- Benchmark unchanged at **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.

## [0.1.13] - 2026-11-22

### Added
- Per-package config discovery: `.slopgate.json` / `slopgate.config.json` is searched from the scan target upward to the git repository root, and the nearest config wins. `packages/app` uses its own package config; `src` without one falls back to the root config. Baselines remain shared at the repository root.
- `slopgate init <dir>` writes the config in `<dir>` and the workflow at the repository root, with the workflow command targeting `./<dir>`. Root `init` output is unchanged.
- `--verbose` shows the resolved config path, e.g. `packages/app/.slopgate.json`, not just the filename.

### Changed
- Git-root discovery runs once per scan and is reused for config search, baseline root and output prefix.
- **Behavior change:** `init <subdir>` now writes the config in that subdirectory (0.1.12 wrote it at the repo root); this makes generated package configs actually apply. The workflow still lives at the root.
- 263 tests, including a monorepo package-vs-root config test, package config `init`, and the updated subdirectory init expectations.
- Benchmark unchanged at **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.

## [0.1.12] - 2026-11-22

### Fixed
- Baseline fingerprints are normalized to repository-relative paths, so one baseline written with `slopgate .`, `slopgate src` or `slopgate src/a.py` suppresses the same findings from any target.
- `slopgate init <subdirectory>` writes `.slopgate.json` and `.github/workflows/slopgate.yml` at the repository root, matching scan/config semantics; non-git targets keep the requested directory.

### Changed
- **Migration:** baselines written by 0.1.11 while scanning a subdirectory contain target-relative keys and are no longer matched; recreate them from the root or with the current version. Baselines written from the repository root remain compatible.
- 261 tests, including mixed root/directory/file baseline reads and subdirectory `init`.
- Benchmark unchanged at **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.

## [0.1.11] - 2026-11-22

### Fixed
- `.slopgate.json` and `.slopgate-baseline.json` are now loaded from the nearest git repository root, not from the scan target. `slopgate src` and `slopgate src/a.py` see the same `rules` / `include` / `exclude` / `ignoreModules` / `confidence` / `failOn` settings as `slopgate .`, matching MCP.
- Default and explicit baseline paths resolve from the repository root. `--write-baseline` started from `src` now writes `<repo>/.slopgate-baseline.json`, and later scans from any subdirectory read it.
- Manifest and local-module resolution remains target-scoped, so monorepo packages still use their own `package.json` / `pyproject.toml`.

### Changed
- **Behavior change:** a baseline written by an older version inside a scanned subdirectory is no longer found automatically; move it to the repository root or pass `--baseline`.
- 259 tests, including repo-root config applying to directory/file scans and default-baseline read/write at the root.
- The performance guard now ignores corpora under 1000 ms, so 5% comparisons target the CPython-scale scan rather than JavaScript startup noise.
- Benchmark unchanged at **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.

## [0.1.10] - 2026-11-22

### Fixed
- Reporter output paths are repository-relative when the scan target is inside a git repository. `slopgate src`, `slopgate src/a.py` and absolute targets now emit `src/a.py` in JSON, pretty, SARIF and GitHub annotations instead of `a.py`. The prefix comes from the nearest `.git` marker (filesystem walk, no subprocess); non-git targets keep target-relative paths. Baseline fingerprints and diff filtering continue to use the raw target-relative paths.
- Documented and tested that a rule set to `severity: "info"` stays visible but still fails CI; `off` or a baseline is the exemption mechanism.

### Changed
- 257 tests, including single-file/subdirectory reporter paths, SARIF/GitHub annotations, and the `severity-override` fixture.
- Benchmark findings unchanged at **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.

## [0.1.9] - 2026-11-22

### Changed
- Documented that a config `include` replaces the default Python/TS/JS pattern set, while CLI `--include` appends to it. `--verbose` now prints the effective include count so a reduced file set is visible.
- `py/noop-test` reuses the `function_definition` list already collected by the rule instead of walking the tree a second time for the helper index.
- Added `include-semantics` coverage: default 3 files, config `src/**` 2 files, CLI `--include src/**` 3 files, and verbose shows 11 patterns.

### Unchanged
- No runtime behavior change to include handling; this is documentation and visibility only.
- Benchmark remains **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.
- 255 tests.

## [0.1.8] - 2026-11-22

### Fixed
- `py/noop-test` now looks up only the local helper called by the test’s last statement. The name→node map is a light single walk; `hasAssertion` runs once per called helper and is cached. Test-heavy files no longer scan every function body, and the full CPython benchmark returns to ≈10.98 s (from 11.72 s).
- Unknown rule ids in `.slopgate.json` are now configuration errors (exit 2, MCP tool error), matching `--rule py/nope` and the README exit-code table. `--quiet` no longer hides the message.

### Changed
- 252 tests, including the `bad-rule-config` CLI case, the engine rejection test, and helper-lookup coverage.
- Benchmark findings unchanged at **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.
- Performance-guard recommendation for the large CPython corpus tightened from 10% to 5%.

## [0.1.7] - 2026-11-22

### Fixed
- `py/noop-test` builds its local-helper index lazily, only when a test actually lacks an assertion. This removes the unconditional full-tree walk introduced in 0.1.6 and restores the rule’s scan cost (≈10.4 s → 9.9 s for `--rule py/noop-test` on the full CPython corpus).
- `py/swallowed-exception` checks whether a comment is a real explanation before applying future-work noise. “The caller retries later, so we ignore this error” demotes, while “refactor this later” stays high.

### Added
- Benchmark performance guard: `--max-regression <percent>` compares per-corpus `durationMs` with the previous results file, ignores corpora under 100 ms, and exits 1 on a regression. Intended for same-machine runs.

### Changed
- 250 tests, including the `future-words` fixture and performance-guard unit tests.
- Benchmark findings unchanged at **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.

## [0.1.6] - 2026-11-22

### Fixed
- `py/swallowed-exception` treats future-work wording (`later`, `next sprint/release/iteration`, `someday`, `eventually`) as noise again, while a real cleanup explanation without future wording still demotes.
- `py/noop-test` recognises a test whose last statement calls a module-local helper containing an assertion, reporting it at medium confidence. This matches the TypeScript delegated-helper behaviour; the lexical assertion-name list remains for `verify(...)`-style helpers.

### Changed
- 245 tests, including sixth-round regression fixtures for `noise`, `py-named-helper` and `py-delegated`.
- Benchmark unchanged at **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.

## [0.1.5] - 2026-11-22

### Fixed
- `ts/noop-test` reports a single test-callback parameter passed to a helper (`(t) => runSuite(t)`) as medium (“assertions may be delegated”) instead of high. Multi-parameter table-driven callbacks are not treated as delegation.
- `ts/unreachable` skips erased `type`, `interface` and `declare` declarations after a terminator; `enum`, classes, `let`/`const` and initialised `var` still report.
- `py/swallowed-exception` no longer treats `cleanup`/`refactor`/`next sprint` as blanket noise; only TODO/FIXME/XXX/HACK tags are noise. Comments on the `except` line now count, and inline comments no longer pollute the exception type, so broad handlers keep the “comment explains why” message.
- `ts/stub-function` reports object-literal arrow properties that throw “Not implemented” at medium confidence, matching class methods.

### Changed
- 241 tests, including fifth-round regression fixtures for `delegated-assert`, `ts-type-after-return`, `cleanup-word`, `comment-placement` and the conservative `wording` cases.
- Benchmark unchanged at **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.
- Docs record the accepted above-`try` wording conservatism (a bare “known bug” stays high by design).

## [0.1.4] - 2026-11-22

### Fixed
- `ts/noop-test` recognises the Tape/TAP assertion API again (`t.equal`, `t.deepEqual`, `t.strictEqual`, `t.doesNotThrow`, …), fixing a regression introduced in 0.1.1; a framework matrix test now pins the accepted assertion families.
- `ts/unreachable` no longer reports hoisted `function`/generator declarations or bare `var` statements after a `return`; `let`/`const` and initialised `var` are still reported.
- `ts/stub-function` reports class-method `throw new Error("Not implemented")` at medium confidence; standalone/exported throw-stubs remain high.
- `py/stub-body` skips `dummy_multiprocessing/`-style prefixed directories when the module docstring identifies a no-op shim, while `dummy_data/` remains reported.
- `py/swallowed-exception` only accepts standalone explanatory comments; a trailing comment on a preceding code line no longer demotes. Above-`try` comments need paired failure/intent wording (or a strong phrase such as "harmless"), and TODO/FIXME/refactor comments do not count. Inline comments on the handler line still count.
- `ts/dead-branch` now has the same nearby-comment demotion as `py/dead-branch`.

### Changed
- 228 tests, including fourth-round regression fixtures for `tape-assert`, `hoisted-fn`, `assert-forms`, `above-heuristic`, `above-trailing`, `between-asymmetry` and `dummy-dir-shim`.
- Benchmark unchanged at **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects, 0 high findings on 601 JavaScript files**; `staleLabels: []`, `unlabeledHigh: []`.
- Docs now state that the nine JS packages do not exercise Tape/TAP or bundled output, and record the Electron-asar corpus findings as the motivation for a future JS corpus expansion.

## [0.1.3] - 2026-11-22

### Fixed
- MCP `scan_path` and `scan_diff` now return a tool error (`isError: true`) when zero files match, matching the CLI's exit 2 instead of reporting a clean run.
- `py/swallowed-exception` counts an explanatory comment immediately above `try` (keyword-filtered so a generic "parse the payload" comment does not hide a silent handler), and no longer includes a trailing comment on the last try-body line (off-by-one in the window start).
- `py/stub-body` skips `dummy_threading.py`-style modules again: exact no-op directories plus file stems starting `dummy_`/`noop_`/`_dummy_`; `dummy_data/` and `shims/` real stubs remain reported.
- `ts/noop-test` recognises renamed `node:assert` imports (namespace, default, named aliases and `require` bindings) as assertions.
- The extension language/dialect tables are merged into one map, so an extension cannot be present in one table and silently dropped from discovery.
- Added a docs test that fails when README or the demo artwork version disagrees with `package.json`; RELEASE now lists the docs update.

### Changed
- 193 tests, including third-round regression fixtures for `window`, `renamed-assert` and `dummy-variants`.
- Benchmark re-run: **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects detected, 0 high findings on 601 JavaScript files.** One 0.1.2 label became stale after the comment-window change and was pruned; the file now has 18 labels covering 29 occurrences, with `staleLabels: []` and `unlabeledHigh: []`.
- Docs: MCP zero-file behaviour, the four comment placements, dummy naming variants, and renamed assert imports are documented.

## [0.1.2] - 2026-11-22

### Fixed
- `ts/noop-test` analyses `test.runIf(...)`, `test.skipIf(...)` and `test.for(...)` again; the 0.1.1 modifier whitelist skipped them entirely.
- Bare assertion helpers such as `assertEqual`, `assertNotNull` and `assertTruthy` count as assertions again.
- `py/swallowed-exception` scopes explanatory comments to the region between the end of the try body (or the previous handler) and the current handler. A comment inside the try body no longer hides a silent `except: pass`, and an earlier comment no longer excuses a later handler.
- `py/stub-body` skips only exact no-op path segments (`dummy`, `_dummy`, `noop`, `no_op`, `no-op`); `dummy_data/` and genuinely unfinished `shims/` code are reported again.
- Imports under `sys.version_info` / `platform.python_version()` / `six.PY2` guards are ignored, matching the existing `sys.platform` handling.
- `stats.byLanguage` reports `javascript` for `.js`/`.jsx`/`.mjs`/`.cjs` instead of counting them as `tsx`.
- The release workflow skips npm publish and GitHub release with a warning when `NPM_TOKEN` is missing instead of failing the tag run.
- The unified-diff parser no longer leaves an empty line-set entry for a deletion-only hunk.
- Internal cleanup: the pyproject parser no longer shadows the outer `names` variable.

### Changed
- 179 tests, including second-round regression fixtures for `assert-helpers`, `try-comment`, `noop-overmatch`, `pyproject-edge` and `test-call-forms`.
- Benchmark re-run: **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects detected, 0 high findings across 601 JavaScript files.** 19 labels cover 29 high-finding occurrences; stale and unlabeled findings are zero. The corrected comment window surfaced one previously labeled-tp finding in `idlelib/debugger.py`, which was re-added to the labels.
- JSON consumers see a new `byLanguage.javascript` bucket; `.js`/`.jsx` counts no longer inflate `tsx`.
- Docs: symlink counting clarified, host-only module limitation added, README CI snippet pins the release version, benchmark digest marked as a 64-bit truncation.

## [0.1.1] - 2026-11-22

### Fixed
- `.pyi` type stubs and deliberate no-op shim modules (for example `multiprocessing/dummy`) are no longer reported as unfinished stubs.
- `pyproject.toml` parsing now understands `[project.optional-dependencies]`, `[dependency-groups]` (PEP 735, including `include-group`), `[tool.uv] dev-dependencies`, and every `[tool.poetry.group.<name>.dependencies]` group.
- Import-name to distribution-name mapping now covers `docx`, `pptx`, `grpc`, `git`, `nacl`, `jose`, `fitz`, `ldap`, `rest_framework` and others, and resolves dotted prefixes (`google.protobuf`) without mapping every `google.*` import to `protobuf`.
- `ts/noop-test` recognises `node:assert` method assertions (`assert.strictEqual`, `assert.ok`, `assert.deepStrictEqual`, `assert.match`, …), `t.ok`/`t.assert.*`, and no longer mistakes `test.valid.forEach(...)` for a test declaration.
- `py/swallowed-exception` counts explanatory comments between the `try` body and `except`; comment detection now uses real comment nodes instead of scanning for `#`/`//` in strings.
- `conftest.py`, `noxfile.py` and `docs/conf.py` are treated as test/build infrastructure, so their imports are demoted instead of failing CI.
- Imports under `sys.platform` / `platform.system()` guards are ignored (platform-specific modules).
- `confidence: "toString"` (or any other `Object.prototype` key) is rejected instead of silently hiding every finding.
- Scanning zero files exits 2 with a message instead of reporting a clean run.
- `--fail-on medium` (or `low`) no longer acts as a no-op when `--confidence` is higher: the display threshold is lowered so failing findings are visible.
- A `.js`/`.mjs`/`.cjs` file is parsed with the TSX grammar, so JSX in `.js` no longer forces every finding down to `medium`.
- The unified-diff parser tracks hunk state, so a content line such as `++ x;` can no longer be mistaken for a `+++` file header.
- A UTF-8 BOM is stripped before parsing, so line 1 columns are no longer off by one.
- Glob patterns support `{a,b}` alternatives (including nesting), so `**/*.{ts,tsx}` works.
- SARIF artifact URIs are percent-encoded (spaces, `#`, non-ASCII).
- `--write-baseline` records all current findings even when `--diff` is also set.
- A failed grammar load is no longer cached forever, and ignored directories no longer inflate `stats.skipped`.
- `slopgate init` pins the installed version instead of `@latest`, and reports relative paths consistently.

### Changed
- 166 tests, including regression fixtures for every fix above.
- Benchmark re-run after the fixes: **26 high-confidence findings across 991,705 lines of CPython, 96.2% labeled precision (25/26), 14/14 seeded defects detected, 0 high findings across 601 JavaScript files.** The labels now cover every high finding, stale labels are zero, and the results carry a corpus digest so the run can be verified without absolute paths.
- Docs now state that `--diff` and MCP `scan_diff` invoke `git` (and therefore need a sandbox that permits child processes), that labels are per fingerprint and come from a development set, and that the benchmark has no minimum-sample exclusion.

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

