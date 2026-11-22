# AI-generated corpus

This is a static, offline corpus of short programs produced from a fixed prompt
set for benchmark and regression testing. It is not a random sample of model
output and must not be used to estimate a model's overall error rate.

`PROVENANCE.md` records the generation context. Every high-confidence finding
is labeled in `benchmark/labels.json`; expected rule/file pairs are listed in
`benchmark/seeded.json`.

`clean/` contains negative controls that should not produce findings.
