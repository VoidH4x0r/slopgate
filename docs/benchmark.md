# Benchmark methodology

The point of this document is to make our central claim **falsifiable**. Anyone should be able to repeat it and get a similar number.

> Status (1.0.4): **42 high-confidence findings across 1,115,270 lines, 97.6% labeled precision (41/42), 30/30 seeded defects detected, 0 high findings on 601 JavaScript files, and 13 high findings on a 20-file AI-generated regression corpus.**

## The claim

> Every finding reported at `high` confidence describes a pattern that is present in the code as written.

Precision is measured by labeling every distinct high-confidence **fingerprint** as `tp` or `fp`; `fp` means the report is misleading (for example, a helper function named `test_*` that is not a test). We publish the labels, not just the ratio.

## Corpus

Three corpora:

1. **Human-written code (false-positive side).** The published run uses the **CPython 3.14.7 standard library** (1,845 files, 991,705 lines) because it is unusually adversarial: it contains hundreds of helper functions named `test_*`, interface stubs, and deliberate no-ops. The JavaScript half is the published tarballs of nine packages — `eslint@10.15.0`, `express@5.3.0`, `execa@10.2.1`, `semver@7.8.6`, `chalk@6.0.1`, `commander@15.1.0`, `debug@4.4.3`, `yargs@18.2.0`, `glob@14.0.6` — 601 files and 123,472 lines, scanned package by package so each resolves its own manifest.
2. **Seeded defects (recall side).** `fixtures/demo` — a miniature repository with 14 deliberately planted defects, one per rule — and `fixtures/ai-generated`, a 20-file corpus generated from a fixed prompt set. `benchmark/seeded.json` lists the expected `file + ruleId` pairs for both.
3. **AI-generated regression corpus (false-positive and AI-shape side).** `fixtures/ai-generated` contains 10 Python files, 6 TypeScript files and 4 clean controls (20 source files, 93 lines). It was generated from a fixed prompt set and committed with `PROVENANCE.md`; it is a static regression corpus, **not** a representative sample of model output. Its 13 high-confidence findings are labeled in `benchmark/labels.json`.

Repositories are not vendored. Each corpus is identified in `benchmark/results.json` by a **SHA-256 digest over its scanned files, truncated to 64 bits** (relative path + content), plus the package name/version when a `package.json` exists. Files are hashed in sorted relative-path order with CRLF normalized to LF, so a Windows and a Linux checkout of the same tree share one identity. The digest lets another checkout prove it is running the same tree without publishing absolute paths. The CPython corpus is a local 3.14.7 install rather than a git checkout, so it is identified by digest and version, not by commit.

Known false positive in the published run: `platform.py` imports `java.lang` inside the Jython-only `_java_getprop` helper. The pattern is present, but the report is not actionable on CPython; it is labeled `fp` and counted in the ratio.

### Human-written corpus caveat

The false-positive corpus is human-written code, which rarely contains AI-specific shapes such as `except Exception as error:` followed by `pass`. Those patterns are covered by `fixtures/ai-generated`, a fixed-prompt regression corpus; it is not a representative sample of model output and does not replace a held-out AI-PR corpus.

### What the JavaScript half does not cover

The nine packages are popular, hand-maintained libraries, not a hostile JavaScript corpus. They contain **no Tape/TAP test suites, no bundler chunks, and no interface-stub class methods**, so their 0-high result is evidence for those packages, not for JavaScript generally. Separate Tape/TAP and bundled-app runs below cover those shapes; the original 6,012-file Electron `app.asar` observation that exposed three pattern classes (126 `t.equal`-style assertions, 83 hoisted declarations after `return`, and 65 class methods that throw `Not implemented`) remains a local regression source, not a published number.

### Go corpus

The Go half uses the local source tree of **Go 1.24.0** (`go/src`, 6,090 files, 2,455,171 lines), scanned with `--include '**/*.go'`. It reports **0 high-confidence findings** and is recorded separately from the Python/JS/AI-run in `benchmark/go-results.json`. The run has **72 parse errors**, so this is 0 high among successfully parsed files; high-confidence findings in a file with syntax errors are deliberately demoted to medium. File/line counts come from the benchmark's discovery walk; vendor/third-party trees are excluded from scanning but may still contribute to raw line counts.

```bash
node scripts/benchmark.mjs \
  --corpus go-stdlib=/path/to/go1.24.0/src \
  --include '**/*.go' \
  --labels benchmark/go-labels.json \
  --out benchmark/go-results.json \
  --report benchmark/go-report.md
```

The source tree is identified by digest rather than committed. There are no Go labels because the run has no high findings; the label file is intentionally empty.

### Rust corpus

The Rust half uses the local **Rust 1.83 `rust-src`** tree (1,494 files, 635,245 lines), scanned with `--include '**/*.rs'`. It reports **0 high-confidence findings** and is recorded in `benchmark/rust-results.json`. The run has **157 parse errors (10.5% of files)**, so this is 0 high among parsed files; high findings in a syntactically broken file are demoted to medium rather than silently counted as clean.

```bash
node scripts/benchmark.mjs \
  --corpus rust-stdlib=/path/to/rust-src-1.83.0/rust-src \
  --include '**/*.rs' \
  --labels benchmark/rust-labels.json \
  --out benchmark/rust-results.json \
  --report benchmark/rust-report.md
```

The source tree is identified by digest rather than committed. There are no Rust labels because the run has no high findings; the label file is intentionally empty.

### Tape/TAP corpus

The Tape repository (`tape@5.11.0`, tests and examples) is checked out with `git clone --depth 1 --branch v5.11.0 https://github.com/tape-testing/tape.git` and scanned with `--include '**/{test,example}/**/*.{js,mjs,cjs}'`: **185 files / 11,958 lines / 0 high**. It exercises TAP callbacks that assert through `t.plan`, aliased assertions and subtests. The result is in `benchmark/tape-results.json`; labels are empty because there are no high findings.

### Held-out AI corpus

`fixtures/ai-heldout` is a fixed 10-file regression set written from a separate prompt list after the main AI corpus was frozen. It contains 8 seeded high findings, all labeled `tp` in `benchmark/heldout-labels.json`; the held-out run is kept separate from the main precision number so it can be used as a check rather than a tuning set.

### Bundled-app corpus

A local Electron `app.asar` (ASUS ArmouryDevice, `.webpack` bundle) is scanned as a packaged-JavaScript corpus with `--include '**/*.{js,mjs,cjs}'`: 6 files, 332 lines, **0 high findings**. The result is recorded in `benchmark/bundled-results.json`. The asar is not committed; the digest identifies the extracted tree.

## Reproducing

```bash
npm run build
node scripts/benchmark.mjs \
  --corpus cpython-stdlib=/path/to/cpython-3.14.7/Lib \
  --corpus express=./bench/js-corpus/express-5.3.0/package \
  --corpus ai-generated=./fixtures/ai-generated
```

The script scans each corpus with the shipped defaults, counts findings by rule and confidence, joins them with `benchmark/labels.json` by fingerprint, and writes `benchmark/results.json` plus `benchmark/report.md`. It also reports **stale labels** (fingerprints no longer produced) and **unlabeled high findings**, so a release cannot silently drift away from its published ratio.

### Performance guard

Timings are machine- and load-dependent, so the guard is opt-in and intended for repeated runs on the same machine:

```bash
node scripts/benchmark.mjs … --max-regression 5
```

It compares each corpus’s `durationMs` with the existing `--out` file before overwriting it, prints any corpus that is more than the given percentage slower, and exits 1. Corpora whose baseline is under 1000 ms are ignored because startup/timer noise dominates them; new or missing corpora are ignored too.

### Duplicate collection at high confidence

Duplicate rules are `medium`, but a warm scan still collects signatures when the display threshold is `high`. A local 2026-11 measurement on the CPython corpus (1,845 files) was:

| Duplicate rules | Warm run 1 | Warm run 2 |
| --- | --- | --- |
| On | 12.0 s | 12.2 s |
| Off | 11.0 s | 10.9 s |

The overhead is about 1 second, or roughly 9% of a scan that is already dominated by parsing and project resolution. The rules stay enabled by default because the findings reappear with `--confidence medium` and the hidden count remains honest; very large repositories can still disable them in config.

## Metrics reported

| Metric | Definition |
| --- | --- |
| High findings per kLOC | high-confidence findings / 1,000 lines scanned |
| Precision (per rule) | labeled tp / (tp + fp), high confidence only |
| Precision (overall) | same, over all labeled high findings |
| Recall (seeded) | detected seeded defects / seeded defects |
| Suppression rate | findings suppressed inline / total findings (a proxy for noisy rules) |

## Labels and limitations

- Labels are **per fingerprint**, not per occurrence: identical snippets in one file share a label. The published run has 31 labels covering 42 high-finding occurrences.
- The labels were produced while iterating on the same corpus. Precision is therefore a **development-set measurement, not a held-out estimate**; a rule tuned against these labels is not evidence that it generalises.
- Label additions, removals and disputed labels are recorded in `CHANGELOG.md`. There is no "fewer than 10 samples" exclusion: every rule with at least one labeled high finding appears in the per-rule table, with its sample count.
- False negatives found after release are added to the fixture corpus or to a future corpus; they are not silently patched without a test.
- A reviewer can dispute any label in an issue; the label file is small enough to audit.

## What this benchmark does not measure

- **Usefulness.** A finding can be correct and still be intentional (the CPython swallowed-exception findings usually are). The report separates "is it true" from "would you act on it" only implicitly, through the notes in the labels file.
- **AI-generated code specifically.** The 20-file `fixtures/ai-generated` corpus is a fixed-prompt regression set. The real AI pull request corpus below is the sample used to estimate how the rules behave on merged agent code.

## Real AI pull request corpus

The other corpora are human-written code plus synthetic AI fixtures. This corpus is 150 **merged pull requests written by AI coding agents** and published with provenance.

### Provenance and selection

- Source: [`hao-li/AIDev`](https://huggingface.co/datasets/hao-li/AIDev) v5 (cutoff 2026-03-31). AIDev only ships metadata and patches; the code is fetched from GitHub at each PR's merge commit.
- Selection: merged PRs from repositories with more than 100 stars, one of six agents (`Claude_Code`, `Copilot`, `OpenAI_Codex`, `Cursor`, `Devin`, `Google_Jules`), and a permissive repository license.
- Size: 150 PRs from 121 repositories, 703 changed files, 461,062 lines.
- Languages: Python 45, TypeScript/JavaScript 45, Go 30, Rust 30.
- Licenses: MIT 91, Apache-2.0 54, BSD-3-Clause 3, CC0-1.0 1, Unlicense 1.
- `benchmark/ai-pr/manifest.json` records every PR, its merge commit, agent, license and the SHA-256 of each changed file.

### Why the corpus ships a skeleton, not the repositories

Downloading 121 full repository snapshots is not practical here: GitHub's archive endpoint was measured at roughly 11 KB/s on this network and frequently returns 504 for large repositories (the repositories total 54 GB of git objects).

Scanning only the changed files without the rest of the repository is not valid either: the four `phantom-import` rules need the repository layout, and a two-PR trial produced 52 false positives out of 56 high findings.

The corpus therefore ships a **structural skeleton** per PR: a GitHub tree listing reproduces every source path as an empty placeholder file, the real dependency manifests (`pyproject.toml`, requirements files, `package.json`, `tsconfig`, `go.mod`, `Cargo.toml`, lockfiles) are fetched verbatim, and the changed files keep their real content. Import resolution sees the same module layout as the original repository while only the changed files are scanned.

The archive is a GitHub release asset (`ai-pr-corpus-v1.tar.gz`, about 28 MB) because it contains third-party code; the manifest stores its SHA-256 and the fetch script verifies it before unpacking.

### Running it

```bash
npm run build
node scripts/fetch-ai-pr-corpus.mjs
node scripts/benchmark-ai-pr.mjs
```

The corpus is unpacked under the user's cache directory (`$XDG_CACHE_HOME/slopgate/ai-pr`, or `~/.cache/slopgate/ai-pr`), not inside the checkout. A cache inside the repository makes the project resolver walk up into slopgate's own manifests and resolve imports against the wrong tree; the benchmark also pins every resolution root to the corpus entry so an accidental in-repo cache cannot change the result.

The benchmark exits non-zero when a high finding is unlabeled, a label no longer matches, or a corpus file fails its digest check. The weekly benchmark workflow runs both commands and compares the result with the committed `results.json`; `--update-baseline` is the explicit way to record an intended change.

### Published result

- **82 high-confidence findings, all labeled `tp`: 100% labeled precision on the high tier.**
- The 29 findings that the earlier corpus run reported at high and are now demoted are still visible at `medium`: 21 TypeScript imports that another workspace package declares, and 8 Python imports declared by a sibling subproject (`mcp_cloud/requirements.txt` for a file under `mcp_local/`). The `phantom-import` rules now consult every project manifest in the repository before claiming a package is missing, so the high-confidence claim is limited to imports no manifest anywhere declares.
- 150 PRs, 703 changed files, 461,062 lines, about 20 seconds.
- `benchmark/ai-pr/results.json` and `benchmark/ai-pr/report.md` are committed; `benchmark/ai-pr/labels.json` holds the labels.

The earlier corpus run produced eight high-confidence `phantom-import` reports for packages declared in a sibling subproject's manifest. That was a real false-positive class, not a label dispute: the rule now merges every project manifest in the repository before it claims a package is missing, and those reports are medium confidence with the sibling declaration as evidence.

### Limits

- A skeleton is not the original tree: generated files, deleted files and vendored trees are absent, so this corpus under-reports findings that need them.
- The corpus is a sample of merged (reviewed) agent code, not of all agent output. Merged code has already passed human review.
- Labels were produced while iterating on the rules in the same session; this is a development-set measurement, not a held-out estimate.

