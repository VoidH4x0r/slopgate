# Development roadmap

Status: **1.0.1 is the review-hardened stable candidate; 1.0.0 is published**. 0.2.10 shipped the encoding contract; 0.3.0 added Go; 0.3.1 added Rust; 0.3.2 added VS Code; 0.4.x added semantic duplicates, integrations and complete benchmark coverage. This roadmap is effort-based, not a promise of dates.

## 1. Product thesis

`slopgate` is a precision-first structural linter for AI-written code. The product is not "more rules"; it is **findings a reviewer can trust** in a green CI run.

The durable advantages are:

- real ASTs plus project context (manifests, imports, tests, duplicate bodies);
- confidence tiers with `high` as the default gate;
- offline operation and no subprocess during scans;
- baseline and diff modes for adoption;
- MCP so coding agents can self-check;
- published false-positive labels, not just a precision claim.

Every roadmap decision should protect those advantages.

## 2. Current baseline

| Area | State at 0.2.9 |
| --- | --- |
| Languages | Python, TypeScript/JavaScript, Go, Rust |
| Rules | 28, all with negative tests |
| Interfaces | CLI, JSON, SARIF, GitHub annotations, MCP, baseline, diff, suppression |
| Autofix | Safe deletion of unreachable statements after `return` / `raise` / `break` / `continue` |
| Benchmark | 1,115,270 Python/JS/AI lines: 42 high, 97.6% precision, 30/30 seeded; Go: 2,455,171 lines, 0 high; Rust: 635,245 lines, 0 high |
| Runtime | Node >= 20.11, tree-sitter WASM grammars |
| Release | npm `@voidh4x0r/slopgate`; latest published 1.0.0, 1.0.1 review-hardened candidate; VS Code extension 0.1.0 |

The current limitations are documented in `README.md`. The biggest product gaps are language coverage, editor integration, semantic duplicate detection, and a benchmark that still under-represents JavaScript test theatre and bundled output.

## 3. Non-goals

These are intentionally out of scope, even if users ask for them:

- formatting, import sorting, or style rules (use `ruff`, `eslint`, `prettier`);
- type checking (use `tsc`, `mypy`, `pyright`);
- whole-program data-flow analysis (use `semgrep` or CodeQL);
- network calls during a scan;
- a hosted dashboard or SaaS in the 0.2.x to 0.4.x window;
- language parity for every rule on day one. Start with the rules that need AST plus project context.

## 4. Release principles

1. **Precision before coverage.** A new language or rule ships only with a negative-test suite and a benchmark corpus.
2. **One new language per minor.** Do not put Go and Rust in one release unless both have independent benchmarks and owners.
3. **No rule without a false-positive story.** Every rule must state what legitimate code looks like and why it is skipped.
4. **No heuristic language detection.** Encoding and language policy are explicit path contracts; see `docs/encoding.md`.
5. **Every release has an exit gate.** Tests, `verify`, benchmark labels, package contents, encoding check, and a Windows CI run.
6. **The public contract is semantic.** Rule IDs, config keys, JSON fields, SARIF fields, MCP methods and exit codes are stable within a major version.

## 5. Release plan

### 0.2.10 - maintenance and release hardening

Goal: make the current two-language product boringly reliable. Target: 2 to 3 weeks.

| Workstream | Deliverable | Acceptance |
| --- | --- | --- |
| Encoding contract | Ship `docs/encoding.md`, policy checker, English-docs whitelist | `npm run check:encoding` passes on Linux and Windows |
| Stale docs | Fix the duplicate-block limitation that still says 0.2.2; refresh roadmap and benchmark text | No stale version references in user docs |
| Autofix matrix | Tests for `--fix` with `--diff`, `--rule`, `--confidence`, `--verbose`, `--format`, `--quiet`; actual read-only file behavior | Every combination has a test or an explicit "not supported" error |
| Baseline maintenance | Decide how old baseline entries are pruned; document the behavior | A stale entry no longer silently grows forever |
| CI | Full Windows test/runtime job, not only the encoding job | `npm test`, `verify`, and the packed CLI work on Windows |
| Packaging | `exports`, `prepack`/`prepublishOnly`, WASM license, package contents | Packed tarball installs and runs on Node 20 and 24 |
| Performance | Measure duplicate signature cost at `high`; cache or skip only with evidence | No regression on the published benchmark; documented tradeoff |

Exit criteria:

- 343 or more tests pass on Linux and Windows;
- benchmark high count, precision, recall and labels are unchanged or improved;
- no unlabeled high finding and no stale label;
- packed tarball installs and catches a seeded defect;
- `CHANGELOG` has a 0.2.10 entry and `README` limitations are current.

### 0.3.0 - Go support

Goal: a real Go mode, not a parser demo. **Status: implemented in 0.3.0; pending release validation.**

Scope:

- tree-sitter-go grammar and parser loading;
- Go module resolution: `go.mod`, `go.sum`, local packages, vendored modules;
- project discovery for multi-module repositories;
- test-file detection (`_test.go`);
- rule framework reuse: file rules and `ProjectRule` duplicates.

Initial rule set, chosen for project context rather than style:

| Rule | Confidence | Why it is worth shipping |
| --- | --- | --- |
| `go/phantom-import` | high / medium in tests | unresolved package imports are a classic hallucination |
| `go/noop-test` | high | `func TestX(t *testing.T) {}` with no failure path |
| `go/unreachable` | high | code after `return`, `panic`, `os.Exit` in the same block |
| `go/stub-body` | medium | `panic("not implemented")`, `todo` placeholders |
| `go/swallowed-error` | high / medium | ignored errors in empty `if err != nil` blocks, not every `_ = err` |
| `go/duplicate-block` | medium | normalized function bodies across files |

Go-specific precision traps to solve before shipping:

- generated files and `// Code generated ... DO NOT EDIT.` headers;
- `go:build` constraints and platform-specific files;
- test helpers that take `*testing.T` but are not tests;
- table-driven tests with delayed assertions;
- vendored and module-cache paths.

Exit criteria:

- at least 20 Go fixtures, one positive and one negative per rule;
- a labeled Go corpus of at least 100k lines with zero high findings unless labeled;
- duplicate rule works across packages and respects generated/test exclusions;
- docs, config examples and rule reference updated.

### 0.3.1 - Rust support

Goal: same bar as Go, with Rust-specific ownership and test idioms. **Status: implemented in 0.3.1; pending release validation.**

Initial rules:

- `rs/phantom-import` for unresolved `use` paths and missing Cargo dependencies;
- `rs/noop-test` for `#[test]` functions with no assertion or panic;
- `rs/unreachable` after `return`, `panic!`, `unreachable!`;
- `rs/stub-body` for `todo!()`, `unimplemented!()`, and `panic!("not implemented")`;
- `rs/swallowed-error` for ignored `Result` values, limited to shapes that are actionable;
- `rs/duplicate-block` for normalized function bodies.

Do not ship `unwrap` or `expect` style rules in 0.3.x. They are style and are not precise enough for this product.

Exit criteria: same as Go, plus a Rust test corpus that includes macros, async functions and workspace crates.

### 0.3.2 - VS Code extension

Goal: make findings visible where the reviewer already works, without duplicating rule logic. **Status: implemented in 0.3.2; pending release validation.**

Design:

- separate package `slopgate-vscode`, not a runtime dependency of the CLI;
- spawn the installed `slopgate` binary with `--format json` or consume SARIF;
- diagnostics mapped to file/line/column;
- quick fix only for the existing safe autofix subset;
- status bar and problem matcher;
- configuration reads `.slopgate.json`;
- no network access, no bundled grammars.

Do not build a full language server in 0.3.x. A CLI-backed extension is enough to validate demand.

Exit criteria:

- works on Windows, macOS and Linux against a packed CLI;
- no false diagnostics introduced by the extension layer;
- activation time and memory documented;
- marketplace listing and README with screenshots.

### 0.4.0 - semantic duplicates, benchmark expansion, integrations

Goal: deepen the product where AST plus project context creates a defensible moat. **Status: 0.4.1 completes the Tape/TAP and held-out-AI benchmark coverage; 0.4.0 shipped semantic duplicates, MCP, JSON schema, GitHub Action and pre-commit.**

Workstreams:

1. **Semantic duplicate detection (medium only at first).**
   - normalize identifiers and literals with explicit guards;
   - require a minimum structural similarity and line/token threshold;
   - keep the existing exact duplicate rule as the high-confidence path;
   - label every finding in a new benchmark corpus; if precision is not clearly better than exact duplicates, keep it opt-in and document why.

2. **Benchmark expansion.**
   - add a Tape/TAP test corpus and a bundled-app corpus (the Electron `app.asar` gap already documented);
   - add a held-out AI-generated PR corpus with provenance;
   - add at least one Go and one Rust corpus;
   - publish labels, stale labels and unlabeled high findings in CI.

3. **Integrations.**
   - official GitHub Action with SARIF upload;
   - pre-commit hook recipe;
   - MCP tools for `explain` and safe-fix preview;
   - JSON schema for `.slopgate.json` and `$schema` support already in place.

Exit criteria:

- benchmark at least 1.5M lines across three languages;
- high-confidence precision remains >= 97% with all high findings labeled;
- seeded recall remains 100% on the fixed corpus;
- every new integration has an end-to-end test that does not require network access.

### 1.0.1 - review hardening

Goal: close the 1.0.0 review blockers without changing the public contract. **Status: implemented in 1.0.1.**

Required:

- stable rule IDs, config keys, JSON schema, SARIF fields, MCP methods and exit codes;
- Node 20, 22 and 24 supported on Linux and Windows;
- full Windows CI for tests, runtime and packed CLI;
- performance budget and a reproducible benchmark command;
- package exports and WASM license reviewed;
- migration notes for any config changes since 0.2;
- docs translations under `docs/zh/` using the encoding contract;
- release automation that cannot publish a tarball without the benchmark and encoding gates.

After 1.0, breaking rule or config changes require a major version. New rules can ship in minors if they preserve the precision gate.

## 6. Cross-cutting workstreams

### Rule quality

- Maintain one positive and one negative test per rule.
- Add a rule proposal template with: pattern, legitimate counterexample, confidence rationale, corpus evidence.
- Prefer rules that need manifests or cross-file context. Style rules are commodity.
- Keep parse-error files at medium or lower.

### Benchmark and labels

- Every release regenerates `benchmark/results.json` and `benchmark/report.md`.
- A release is blocked by any unlabeled high finding or stale label.
- Labels are reviewed by a human; do not auto-label.
- Add a "known false positives" section instead of hiding misses.

### Architecture and performance

- Keep the scan offline and subprocess-free; `git` remains limited to `--diff`.
- Reuse parser instances; cache manifests and project indexes per scan.
- Make duplicate signature collection aware of the display threshold only if measurements justify it.
- Keep the rule context stable: `RuleContext` and `ProjectRule` are the extension points until 1.0.

### Distribution and release

- Publish with `npm publish --provenance` when the release environment supports it.
- Pin the release tag to `package.json`; the existing RELEASE checklist stays authoritative.
- Keep the tarball small; tree-sitter WASM remains the main size cost.
- Review third-party licenses before 1.0.

### Documentation and community

- `docs/encoding.md` is the contract for text; do not reintroduce content heuristics.
- Rule reference, benchmark methodology and roadmap stay in sync with the code.
- Translation work starts only when there is a maintainer for it; put translations under `docs/zh/`.
- Use the `good first rule` label for isolated rules with fixtures and a negative test.

## 7. Priority and sequencing

| Priority | Item | Why now |
| --- | --- | --- |
| P0 | 0.2.10 maintenance and release gates | The current product must be trustworthy before adding languages |
| P1 | Go support | Largest adjacent language with clear project-context rules |
| P1 | Rust support | Shared architecture; keeps the "two new languages" promise |
| P2 | VS Code extension | Distribution, not detection; validate demand after languages |
| P2 | Semantic duplicates | High upside, high false-positive risk; needs a benchmark first |
| P3 | More rules for Python/TS | Diminishing returns until benchmark coverage improves |

If only 10 hours per week are available, ship 0.2.10, then Go, then stop. Do not start Rust and VS Code in parallel without an owner for each.

## 8. Metrics

Track per release:

- high-confidence findings and labeled precision;
- seeded recall and missed seeds;
- unlabeled high findings and stale labels;
- high findings on clean JavaScript/Go/Rust corpora;
- runtime and peak memory on the benchmark;
- install size and cold-start time;
- number of rules with positive and negative tests;
- test count and Windows CI status.

A release does not ship if precision drops below 97% or any high finding is unlabeled.

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| New languages dilute precision | Separate 0.3.0/0.3.1 releases; per-language labeled corpus; no rule without negative tests |
| Semantic clones create noise | Medium confidence first; benchmark labels; keep exact duplicate rule as the trusted path |
| Windows path/encoding bugs | Full Windows CI; explicit encoding contract; no PowerShell text round-trips |
| Maintenance burden | One language per minor; no full language server; prefer CLI-backed integrations |
| Benchmark overfitting | Add held-out AI corpus and more human corpora; publish labels and misses |
| Package/license surprises | Packaging gate in 0.2.10; license review before 1.0 |
| Scope creep from style requests | Non-goals section; reject formatting/type-check rules explicitly |

## 10. Next 14 days

1. Cut **0.2.10** from `main` after the encoding contract, stale docs and autofix matrix pass.
2. Add the full Windows test/runtime job; keep the encoding job.
3. Fix `--write-baseline` stale-entry behavior or document the chosen semantics.
4. Run a Go spike: tree-sitter-go parse, module resolution, two rules, 10 fixtures.
5. Decide Go vs Rust order from the spike and available time; write the decision in this file.
6. Do not start VS Code or semantic duplicates before 0.3.0 is benchmarked.

## 11. Decision log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-11-23 | Split Go, Rust and VS Code into 0.3.0, 0.3.1 and 0.3.2 | Each needs its own benchmark and release gate |
| 2026-11-23 | Keep semantic duplicates at medium confidence | Identifier normalization is not precise enough for a high gate |
| 2026-11-23 | Replace content-based CJK heuristics with an explicit encoding contract | Language cannot be inferred reliably from content |
