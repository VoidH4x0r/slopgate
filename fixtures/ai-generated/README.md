# AI-generated corpus

This is a static, offline regression corpus of short programs produced from a fixed prompt set. It exists to keep AI-shaped defects in the test suite even when the human-written benchmark is clean.

- **20 source files / 93 lines**: 10 Python files, 6 TypeScript files and 4 clean controls.
- **13 high-confidence findings**, all reviewed and labeled in `benchmark/labels.json`.
- **30/30 seeded-defect recall** across this corpus plus `fixtures/demo`.
- `clean/` contains negative controls that should not produce findings.

It is **not** a random sample of model output, not a benchmark of model quality, and not a substitute for a held-out AI-PR corpus. It is a fixed set of shapes that the rules must keep catching. `PROMPTS.md` records the prompts; `PROVENANCE.md` records how and when the files were produced.

To reproduce the score:

```bash
npm run build
node scripts/benchmark.mjs \
  --corpus ai-generated=fixtures/ai-generated \
  --labels benchmark/labels.json \
  --out benchmark/results.json
```
