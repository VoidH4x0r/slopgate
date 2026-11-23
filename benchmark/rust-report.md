# Benchmark report

Generated 2026-11-23T02:41:27.522Z by `scripts/benchmark.mjs` (slopgate 0.4.1, Node v24.19.0).

## Summary

| Corpus | Files | Lines | High findings | High / kLOC | Precision (labeled) | Digest (64-bit) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| rust-stdlib | 1494 | 635245 | 0 | 0.00 | — | `fce4df135e171390` |

## rust-stdlib

Scanned **1494** files (**635245** lines) in 40415 ms.

Corpus digest: `fce4df135e171390`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| `rs/duplicate-block` | 0 | 139 | 0 | 0 | — |
| `rs/phantom-import` | 0 | 342 | 0 | 0 | — |

## Method

Corpora are real checkouts identified by a SHA-256 digest over their scanned files, plus the package name/version when a `package.json` exists. `benchmark/results.json` stores the digest, counts and timings, so the run can be compared without publishing absolute paths.

Every distinct `high` fingerprint is labeled in `benchmark/labels.json` as `tp` (the described pattern is present in the code as written) or `fp` (the report is misleading). Labels are per fingerprint, not per occurrence: identical snippets in one file share a label. Precision is `tp / (tp + fp)` over labeled findings; the report also states how many high findings are unlabeled and how many labels are stale.

These labels were produced while iterating on the same corpus, so precision is a development-set measurement, not a held-out estimate. The labels and the harness are published so a reviewer can dispute any of them; label removals and additions are recorded in the changelog.

The corpus is deliberately adversarial: CPython's own test suite is full of helper functions named `test_*` and intentional no-op implementations, which is where the `noop-test` false positives come from.
