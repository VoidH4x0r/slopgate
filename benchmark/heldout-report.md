# Benchmark report

Generated 2026-11-26T12:11:32.032Z by `scripts/benchmark.mjs` (slopgate 1.0.4, Node v24.22.3).

## Summary

| Corpus | Files | Lines | High findings | High / kLOC | Precision (labeled) | Digest (64-bit) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| heldout-ai | 10 | 39 | 8 | 205.13 | 100.0% | `2404daae29252116` |

## Recall (seeded defects)

Detected **30/30** seeded defects.

## heldout-ai

Scanned **10** files (**39** lines) in 259 ms; parse errors: **0**.

Corpus digest: `2404daae29252116`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| `py/noop-test` | 1 | 0 | 0 | 1 | 100.0% |
| `py/phantom-import` | 1 | 0 | 0 | 1 | 100.0% |
| `py/stub-body` | 1 | 0 | 0 | 1 | 100.0% |
| `py/swallowed-exception` | 1 | 0 | 0 | 1 | 100.0% |
| `py/unreachable` | 1 | 0 | 0 | 1 | 100.0% |
| `ts/noop-test` | 1 | 0 | 0 | 1 | 100.0% |
| `ts/phantom-import` | 1 | 0 | 0 | 1 | 100.0% |
| `ts/stub-function` | 1 | 0 | 0 | 1 | 100.0% |

## Method

Corpora are real checkouts identified by a SHA-256 digest over their scanned files in sorted relative-path order with CRLF normalized to LF, plus the package name/version when a `package.json` exists. `benchmark/results.json` stores the digest, counts and timings, so the run can be compared without publishing absolute paths.

Every distinct `high` fingerprint is labeled in `benchmark/heldout-labels.json` as `tp` (the described pattern is present in the code as written) or `fp` (the report is misleading). Labels are per fingerprint, not per occurrence: identical snippets in one file share a label. Precision is `tp / (tp + fp)` over labeled findings; the report also states how many high findings are unlabeled and how many labels are stale.

These labels were produced while iterating on the same corpus, so precision is a development-set measurement, not a held-out estimate. The labels and the harness are published so a reviewer can dispute any of them; label removals and additions are recorded in the changelog.
