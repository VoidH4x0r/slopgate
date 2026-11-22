# Benchmark report

Generated 2026-11-22T11:02:39.404Z by `scripts/benchmark.mjs` (slopgate 0.1.17, Node v24.19.0).

## Summary

| Corpus | Files | Lines | High findings | High / kLOC | Precision (labeled) | Digest (64-bit) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| cpython-stdlib | 1845 | 991705 | 29 | 0.03 | 96.6% | `027f952580cd6622` |
| express | 7 | 2783 | 0 | 0.00 | — | `d2b720bf4294881f` |
| chalk | 2 | 799 | 0 | 0.00 | — | `7e4d9210a0fc613d` |
| execa | 111 | 8363 | 0 | 0.00 | — | `4c7472ad58bd8a01` |
| semver | 49 | 3166 | 0 | 0.00 | — | `2035d82b564fe0fd` |
| commander | 7 | 4225 | 0 | 0.00 | — | `a1904525101c27be` |
| debug | 4 | 841 | 0 | 0.00 | — | `423d0332532c2e32` |
| eslint | 409 | 100880 | 0 | 0.00 | — | `8d19ccdb8205985c` |
| glob | 7 | 2217 | 0 | 0.00 | — | `dc4dc56c06b64fb8` |
| yargs | 5 | 198 | 0 | 0.00 | — | `53ba47a2d90b26ae` |

## Recall (seeded defects)

Detected **14/14** seeded defects.

## cpython-stdlib

Scanned **1845** files (**991705** lines) in 11077 ms.

Corpus digest: `027f952580cd6622`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| `py/dead-branch` | 0 | 4 | 0 | 0 | — |
| `py/noop-test` | 0 | 5935 | 0 | 0 | — |
| `py/phantom-import` | 1 | 105 | 0 | 1 | 0.0% |
| `py/stub-body` | 0 | 281 | 33 | 0 | — |
| `py/swallowed-exception` | 25 | 422 | 0 | 25 | 100.0% |
| `py/tautological-assert` | 3 | 5 | 0 | 3 | 100.0% |

## express

Scanned **7** files (**2783** lines) in 36 ms.

Package: `express@5.3.0`.

Corpus digest: `d2b720bf4294881f`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |

## chalk

Scanned **2** files (**799** lines) in 6 ms.

Package: `chalk@6.0.1`.

Corpus digest: `7e4d9210a0fc613d`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |

## execa

Scanned **111** files (**8363** lines) in 135 ms.

Package: `execa@10.2.1`.

Corpus digest: `4c7472ad58bd8a01`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ts/swallowed-exception` | 0 | 11 | 0 | 0 | — |

## semver

Scanned **49** files (**3166** lines) in 47 ms.

Package: `semver@7.8.6`.

Corpus digest: `2035d82b564fe0fd`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |

## commander

Scanned **7** files (**4225** lines) in 39 ms.

Package: `commander@15.1.0`.

Corpus digest: `a1904525101c27be`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |

## debug

Scanned **4** files (**841** lines) in 9 ms.

Package: `debug@4.4.3`.

Corpus digest: `423d0332532c2e32`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ts/swallowed-exception` | 0 | 4 | 0 | 0 | — |

## eslint

Scanned **409** files (**100880** lines) in 842 ms.

Package: `eslint@10.15.0`.

Corpus digest: `8d19ccdb8205985c`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ts/stub-function` | 0 | 1 | 0 | 0 | — |
| `ts/swallowed-exception` | 0 | 2 | 0 | 0 | — |

## glob

Scanned **7** files (**2217** lines) in 33 ms.

Package: `glob@14.0.6`.

Corpus digest: `dc4dc56c06b64fb8`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |

## yargs

Scanned **5** files (**198** lines) in 8 ms.

Package: `yargs@18.2.0`.

Corpus digest: `53ba47a2d90b26ae`.

| Rule | high | medium | low | Labeled | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |

## Method

Corpora are real checkouts identified by a SHA-256 digest over their scanned files, plus the package name/version when a `package.json` exists. `benchmark/results.json` stores the digest, counts and timings, so the run can be compared without publishing absolute paths.

Every distinct `high` fingerprint is labeled in `benchmark/labels.json` as `tp` (the described pattern is present in the code as written) or `fp` (the report is misleading). Labels are per fingerprint, not per occurrence: identical snippets in one file share a label. Precision is `tp / (tp + fp)` over labeled findings; the report also states how many high findings are unlabeled and how many labels are stale.

These labels were produced while iterating on the same corpus, so precision is a development-set measurement, not a held-out estimate. The labels and the harness are published so a reviewer can dispute any of them; label removals and additions are recorded in the changelog.

The corpus is deliberately adversarial: CPython's own test suite is full of helper functions named `test_*` and intentional no-op implementations, which is where the `noop-test` false positives come from.
