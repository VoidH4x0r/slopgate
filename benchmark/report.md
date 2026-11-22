# Benchmark report

Generated 2026-11-22T04:04:36.780Z by `scripts/benchmark.mjs`.

## Summary

| Corpus | Files | Lines | High findings | High / kLOC | Precision (labeled) |
| --- | ---: | ---: | ---: | ---: | ---: |
| cpython-stdlib | 1845 | 991705 | 35 | 0.04 | 91.4% |
| express | 7 | 2783 | 0 | 0.00 | — |
| chalk | 2 | 799 | 0 | 0.00 | — |
| execa | 111 | 8363 | 0 | 0.00 | — |
| semver | 49 | 3166 | 0 | 0.00 | — |
| commander | 7 | 4225 | 0 | 0.00 | — |
| debug | 4 | 841 | 0 | 0.00 | — |
| eslint | 409 | 100880 | 0 | 0.00 | — |
| glob | 7 | 2217 | 0 | 0.00 | — |
| yargs | 5 | 198 | 0 | 0.00 | — |

## Recall (seeded defects)

Detected **14/14** seeded defects.

## cpython-stdlib

Scanned **1845** files (**991705** lines) in 12069 ms.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| `py/dead-branch` | 0 | 4 | 0 | 0 | — |
| `py/noop-test` | 2 | 5933 | 0 | 2 | 0.0% |
| `py/phantom-import` | 1 | 105 | 0 | 1 | 0.0% |
| `py/stub-body` | 2 | 283 | 33 | 2 | 100.0% |
| `py/swallowed-exception` | 27 | 420 | 0 | 27 | 100.0% |
| `py/tautological-assert` | 3 | 5 | 0 | 3 | 100.0% |

## express

Scanned **7** files (**2783** lines) in 39 ms.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |

## chalk

Scanned **2** files (**799** lines) in 7 ms.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |

## execa

Scanned **111** files (**8363** lines) in 158 ms.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ts/swallowed-exception` | 0 | 11 | 0 | 0 | — |

## semver

Scanned **49** files (**3166** lines) in 63 ms.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |

## commander

Scanned **7** files (**4225** lines) in 46 ms.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |

## debug

Scanned **4** files (**841** lines) in 10 ms.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ts/swallowed-exception` | 0 | 4 | 0 | 0 | — |

## eslint

Scanned **409** files (**100880** lines) in 852 ms.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ts/stub-function` | 0 | 1 | 0 | 0 | — |
| `ts/swallowed-exception` | 0 | 2 | 0 | 0 | — |

## glob

Scanned **7** files (**2217** lines) in 22 ms.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |

## yargs

Scanned **5** files (**198** lines) in 6 ms.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |

## Method

Corpora are pinned checkouts of real repositories. Every finding at `high` confidence is labeled in `benchmark/labels.json` as `tp` (the described pattern is present in the code as written) or `fp` (the report is misleading). Precision is `tp / (tp + fp)` over labeled findings; unlabeled findings are excluded from the ratio but shown in the counts.

The corpus is deliberately adversarial: CPython's own test suite is full of helper functions named `test_*` and intentional no-op implementations, which is where the `noop-test` false positives come from.
