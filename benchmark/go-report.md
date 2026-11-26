# Benchmark report

Generated 2026-11-26T12:09:35.012Z by `scripts/benchmark.mjs` (slopgate 1.0.4, Node v24.22.3).

## Summary

| Corpus | Files | Lines | High findings | High / kLOC | Precision (labeled) | Digest (64-bit) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| go-stdlib | 6090 | 2455171 | 0 | 0.00 | — | `d2c81658b437dc42` |

## Recall (seeded defects)

Detected **30/30** seeded defects.

## go-stdlib

Scanned **6090** files (**2455171** lines) in 31539 ms; parse errors: **72**.

Corpus digest: `d2c81658b437dc42`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| `go/duplicate-block` | 0 | 427 | 0 | 0 | — |

## Method

Corpora are real checkouts identified by a SHA-256 digest over their scanned files in sorted relative-path order with CRLF normalized to LF, plus the package name/version when a `package.json` exists. `benchmark/results.json` stores the digest, counts and timings, so the run can be compared without publishing absolute paths.

Every distinct `high` fingerprint is labeled in `benchmark/go-labels.json` as `tp` (the described pattern is present in the code as written) or `fp` (the report is misleading). Labels are per fingerprint, not per occurrence: identical snippets in one file share a label. Precision is `tp / (tp + fp)` over labeled findings; the report also states how many high findings are unlabeled and how many labels are stale.

These labels were produced while iterating on the same corpus, so precision is a development-set measurement, not a held-out estimate. The labels and the harness are published so a reviewer can dispute any of them; label removals and additions are recorded in the changelog.
