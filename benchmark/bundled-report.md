# Benchmark report

Generated 2026-11-26T12:14:49.290Z by `scripts/benchmark.mjs` (slopgate 1.0.4, Node v24.19.0).

## Summary

| Corpus | Files | Lines | High findings | High / kLOC | Precision (labeled) | Digest (64-bit) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| bundled-app | 6 | 332 | 0 | 0.00 | — | `0848378b4cd9abe3` |

## Recall (seeded defects)

Detected **30/30** seeded defects.

## bundled-app

Scanned **6** files (**332** lines) in 752 ms; parse errors: **2**.

Package: `asus_framework@4.2.5.4`.

Corpus digest: `0848378b4cd9abe3`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ts/stub-function` | 0 | 9 | 0 | 0 | — |
| `ts/swallowed-exception` | 0 | 39 | 0 | 0 | — |

## Method

Corpora are real checkouts identified by a SHA-256 digest over their scanned files in sorted relative-path order with CRLF normalized to LF, plus the package name/version when a `package.json` exists. `benchmark/results.json` stores the digest, counts and timings, so the run can be compared without publishing absolute paths.

Every distinct `high` fingerprint is labeled in `benchmark/bundled-labels.json` as `tp` (the described pattern is present in the code as written) or `fp` (the report is misleading). Labels are per fingerprint, not per occurrence: identical snippets in one file share a label. Precision is `tp / (tp + fp)` over labeled findings; the report also states how many high findings are unlabeled and how many labels are stale.

These labels were produced while iterating on the same corpus, so precision is a development-set measurement, not a held-out estimate. The labels and the harness are published so a reviewer can dispute any of them; label removals and additions are recorded in the changelog.
