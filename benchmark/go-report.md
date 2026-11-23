# Benchmark report

Generated 2026-11-23T08:21:43.398Z by `scripts/benchmark.mjs` (slopgate 1.0.2, Node v24.19.0).

## Summary

| Corpus | Files | Lines | High findings | High / kLOC | Precision (labeled) | Digest (64-bit) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| go-stdlib | 6090 | 2455171 | 0 | 0.00 | — | `3970b1f25e424815` |

## go-stdlib

Scanned **6090** files (**2455171** lines) in 21077 ms; parse errors: **72**.

Corpus digest: `3970b1f25e424815`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| `go/duplicate-block` | 0 | 427 | 0 | 0 | — |

## Method

Corpora are real checkouts identified by a SHA-256 digest over their scanned files, plus the package name/version when a `package.json` exists. `benchmark/results.json` stores the digest, counts and timings, so the run can be compared without publishing absolute paths.

Every distinct `high` fingerprint is labeled in `benchmark/go-labels.json` as `tp` (the described pattern is present in the code as written) or `fp` (the report is misleading). Labels are per fingerprint, not per occurrence: identical snippets in one file share a label. Precision is `tp / (tp + fp)` over labeled findings; the report also states how many high findings are unlabeled and how many labels are stale.

These labels were produced while iterating on the same corpus, so precision is a development-set measurement, not a held-out estimate. The labels and the harness are published so a reviewer can dispute any of them; label removals and additions are recorded in the changelog.
