# Benchmark methodology

The point of this document is to make our central claim **falsifiable**. Anyone should be able to repeat it and get a similar number.

> Status: first results are published in [`benchmark/report.md`](../benchmark/report.md). Current measure: **35 high-confidence findings across 991,705 lines of CPython, 91.4% labeled precision, 14/14 seeded defects detected, and 0 high findings on 601 JavaScript files (9 packages, 123,472 lines).**

## The claim

> Every finding reported at `high` confidence describes a pattern that is present in the code as written.

Precision is measured by labeling every high-confidence finding as `tp` or `fp`; `fp` means the report is misleading (for example, a helper function named `test_*` that is not a test). We publish the labels, not just the ratio.

## Corpus

Two halves, both pinned:

1. **Human-written code (false-positive side).** Locally checked-out repositories. The published run uses the **CPython standard library** (1,845 files, 991,705 lines) because it is unusually adversarial: it contains hundreds of helper functions named `test_*`, interface stubs, and deliberate no-ops. A clean application codebase is easier than this. The JavaScript half is the published tarballs of nine packages — `eslint`, `express`, `execa`, `semver`, `chalk`, `commander`, `debug`, `yargs`, `glob` — 601 files and 123,472 lines, scanned package by package so each resolves its own manifest.
2. **Seeded defects (recall side).** `fixtures/demo` — a miniature repository with 14 deliberately planted defects, one per rule. `benchmark/seeded.json` lists the expected `file + ruleId` pairs.

Repositories are not vendored. `benchmark/results.json` records paths, counts and timings for the run that produced the published report.

## Reproducing

```bash
npm run build
node scripts/benchmark.mjs \
  --corpus cpython=/path/to/cpython/Lib \
  --corpus express=./bench/js-corpus/express-5.3.0/package
```

The script scans each corpus with the shipped defaults, counts findings by rule and confidence, joins them with `benchmark/labels.json` by fingerprint, and writes `benchmark/results.json` plus `benchmark/report.md`.

## Metrics reported

| Metric | Definition |
| --- | --- |
| High findings per kLOC | high-confidence findings / 1,000 lines scanned |
| Precision (per rule) | labeled tp / (tp + fp), high confidence only |
| Precision (overall) | same, over all labeled high findings |
| Recall (seeded) | detected seeded defects / seeded defects |
| Suppression rate | findings suppressed inline / total findings (a proxy for noisy rules) |

## Anti-gaming rules

- The corpus cannot be changed after labels are collected for a release; additions are allowed, removals require a changelog entry.
- Rules cannot be tuned against the labels; tuning happens against an independently collected dev set.
- A rule with fewer than 10 sampled findings is reported but excluded from the headline number.
- False negatives found after release are added to the corpus, not silently fixed.
- Labels are per finding fingerprint and live in the repository; a reviewer can dispute any of them in an issue.

## What this benchmark does not measure

- **Usefulness.** A finding can be correct and still be intentional (the CPython swallowed-exception findings usually are). The report separates "is it true" from "would you act on it" only implicitly, through the notes in the labels file.
- **AI-generated code specifically.** The corpus is human-written. v0.2 adds a corpus of AI-generated pull requests.

