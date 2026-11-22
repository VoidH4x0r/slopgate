# Benchmark methodology

The point of this document is to make our central claim **falsifiable**. Anyone should be able to repeat it and get a similar number.

> Status (0.1.9): **29 high-confidence findings across 991,705 lines of CPython, 96.6% labeled precision (28/29), 14/14 seeded defects detected, and 0 high findings on 601 JavaScript files (9 packages, 123,472 lines).**

## The claim

> Every finding reported at `high` confidence describes a pattern that is present in the code as written.

Precision is measured by labeling every distinct high-confidence **fingerprint** as `tp` or `fp`; `fp` means the report is misleading (for example, a helper function named `test_*` that is not a test). We publish the labels, not just the ratio.

## Corpus

Two halves, both real code:

1. **Human-written code (false-positive side).** The published run uses the **CPython 3.14.7 standard library** (1,845 files, 991,705 lines) because it is unusually adversarial: it contains hundreds of helper functions named `test_*`, interface stubs, and deliberate no-ops. The JavaScript half is the published tarballs of nine packages — `eslint@10.15.0`, `express@5.3.0`, `execa@10.2.1`, `semver@7.8.6`, `chalk@6.0.1`, `commander@15.1.0`, `debug@4.4.3`, `yargs@18.2.0`, `glob@14.0.6` — 601 files and 123,472 lines, scanned package by package so each resolves its own manifest.
2. **Seeded defects (recall side).** `fixtures/demo` — a miniature repository with 14 deliberately planted defects, one per rule. `benchmark/seeded.json` lists the expected `file + ruleId` pairs.

Repositories are not vendored. Each corpus is identified in `benchmark/results.json` by a **SHA-256 digest over its scanned files, truncated to 64 bits** (relative path + content), plus the package name/version when a `package.json` exists. The digest lets another checkout prove it is running the same tree without publishing absolute paths. The CPython corpus is a local 3.14.7 install rather than a git checkout, so it is identified by digest and version, not by commit.

Known false positive in the published run: `platform.py` imports `java.lang` inside the Jython-only `_java_getprop` helper. The pattern is present, but the report is not actionable on CPython; it is labeled `fp` and counted in the ratio.

### What the JavaScript half does not cover

The nine packages are popular, hand-maintained libraries, not a hostile JavaScript corpus. They contain **no Tape/TAP test suites, no bundler chunks, and no interface-stub class methods**, so their 0-high result is evidence for those packages, not for JavaScript generally. A separate 6,012-file Electron `app.asar` corpus (not bundled here) exposed three pattern classes: 126 `t.equal`-style assertions, 83 hoisted declarations after `return`, and 65 class methods that throw `Not implemented`. Version 0.1.4 fixes the underlying rules and adds small regression fixtures for each pattern; version 0.2.0 will add a real Tape/TAP package and a bundled-app corpus to this benchmark.

## Reproducing

```bash
npm run build
node scripts/benchmark.mjs \
  --corpus cpython-stdlib=/path/to/cpython-3.14.7/Lib \
  --corpus express=./bench/js-corpus/express-5.3.0/package
```

The script scans each corpus with the shipped defaults, counts findings by rule and confidence, joins them with `benchmark/labels.json` by fingerprint, and writes `benchmark/results.json` plus `benchmark/report.md`. It also reports **stale labels** (fingerprints no longer produced) and **unlabeled high findings**, so a release cannot silently drift away from its published ratio.

### Performance guard

Timings are machine- and load-dependent, so the guard is opt-in and intended for repeated runs on the same machine:

```bash
node scripts/benchmark.mjs … --max-regression 5
```

It compares each corpus’s `durationMs` with the existing `--out` file before overwriting it, prints any corpus that is more than the given percentage slower, and exits 1. Corpora whose baseline is under 100 ms are ignored because startup/timer noise dominates them; new or missing corpora are ignored too.

## Metrics reported

| Metric | Definition |
| --- | --- |
| High findings per kLOC | high-confidence findings / 1,000 lines scanned |
| Precision (per rule) | labeled tp / (tp + fp), high confidence only |
| Precision (overall) | same, over all labeled high findings |
| Recall (seeded) | detected seeded defects / seeded defects |
| Suppression rate | findings suppressed inline / total findings (a proxy for noisy rules) |

## Labels and limitations

- Labels are **per fingerprint**, not per occurrence: identical snippets in one file share a label. The published run has 18 labels covering 29 high-finding occurrences.
- The labels were produced while iterating on the same corpus. Precision is therefore a **development-set measurement, not a held-out estimate**; a rule tuned against these labels is not evidence that it generalises.
- Label additions, removals and disputed labels are recorded in `CHANGELOG.md`. There is no "fewer than 10 samples" exclusion: every rule with at least one labeled high finding appears in the per-rule table, with its sample count.
- False negatives found after release are added to the fixture corpus or to a future corpus; they are not silently patched without a test.
- A reviewer can dispute any label in an issue; the label file is small enough to audit.

## What this benchmark does not measure

- **Usefulness.** A finding can be correct and still be intentional (the CPython swallowed-exception findings usually are). The report separates "is it true" from "would you act on it" only implicitly, through the notes in the labels file.
- **AI-generated code specifically.** The corpus is human-written. A corpus of AI-generated pull requests is future work.
