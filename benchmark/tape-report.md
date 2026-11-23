# Benchmark report

Generated 2026-11-23T07:21:04.357Z by `scripts/benchmark.mjs` (slopgate 1.0.1, Node v24.19.0).

## Summary

| Corpus | Files | Lines | High findings | High / kLOC | Precision (labeled) | Digest (64-bit) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| tape | 185 | 11958 | 0 | 0.00 | — | `3657d8426287c4a3` |

## tape

Scanned **185** files (**11958** lines) in 257 ms.

Package: `tape@5.11.0`.

Corpus digest: `3657d8426287c4a3`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ts/noop-test` | 0 | 37 | 0 | 0 | — |

## Method

Corpora are real checkouts identified by a SHA-256 digest over their scanned files, plus the package name/version when a `package.json` exists. `benchmark/results.json` stores the digest, counts and timings, so the run can be compared without publishing absolute paths.

Every distinct `high` fingerprint is labeled in `benchmark/labels.json` as `tp` (the described pattern is present in the code as written) or `fp` (the report is misleading). Labels are per fingerprint, not per occurrence: identical snippets in one file share a label. Precision is `tp / (tp + fp)` over labeled findings; the report also states how many high findings are unlabeled and how many labels are stale.

These labels were produced while iterating on the same corpus, so precision is a development-set measurement, not a held-out estimate. The labels and the harness are published so a reviewer can dispute any of them; label removals and additions are recorded in the changelog.

The corpus is deliberately adversarial: CPython's own test suite is full of helper functions named `test_*` and intentional no-op implementations, which is where the `noop-test` false positives come from.
