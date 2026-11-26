# Quality gates

Status: added after 1.0.3. This page describes the automated gates on `main` and how to reproduce them locally.

## On every pull request

- **Tests and coverage.** The Linux test job runs `npm test`, then `npm run test:coverage`, which enforces line 95%, branch 85% and function 92% over `src/`.
- **CodeQL.** JavaScript/TypeScript with the `security-and-quality` query suite. Results appear in the repository Security tab. A finding does not fail the check by default; the check fails only when the analysis itself fails.
- **Dependency review.** Fails a pull request that introduces a `high` or `critical` vulnerability in a runtime dependency (`fail-on-scopes: runtime`). Development-only dependencies are not gated.

## On `main` and on a schedule

- **CI.** The full Linux and Windows matrix, the packed-tarball smoke tests and the VS Code extension.
- **CodeQL.** Also runs on every push to `main` and weekly.
- **Full benchmark.** Weekly (Monday 02:41 UTC) and on manual dispatch. It fetches CPython 3.14.7, Go 1.24.0, Rust 1.83 `rust-src`, the nine published npm tarballs, Tape and the AI corpora, then compares the fresh run with the committed results through `scripts/check-benchmark-drift.mjs`. The job fails on any change in corpus digest, file or high-confidence count, labeled precision, label reconciliation, seeded recall, a parse-error drift beyond 5%, or a CPython scan over 20 seconds.

## Action pinning

Every `uses:` reference in `.github/workflows/` is pinned to a 40-character commit with a `# vX.Y.Z` comment. Dependabot checks the `github-actions` ecosystem weekly and opens update pull requests.

## Reproducing locally

```bash
npm run test:coverage
node scripts/check-benchmark-drift.mjs --new benchmark/results.json --baseline benchmark/results.json
```

The full benchmark needs the external corpora. `node scripts/benchmark.mjs --help` lists the flags, and [benchmark.md](benchmark.md) documents the corpus versions and commands.

## Branch protection

`main` requires a pull request and every required status check. Direct pushes are rejected.
