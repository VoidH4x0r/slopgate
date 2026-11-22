# Release checklist

There is one supported release path: a `v*` tag runs `.github/workflows/release.yml`, which verifies the tag, runs the suite, publishes to npm with provenance, and creates the GitHub release.

Local `npm publish` is an emergency fallback only. It cannot produce a provenance attestation, and it must not be used for a version that will later be tagged.

## 0. Repository slug (already done for this repository)

This repository already points at `https://github.com/VoidH4x0r/slopgate`; `package.json`, badges, CLI help, SARIF metadata and README links are absolute. The step below is only needed for a fork or a fresh scaffold:

```bash
node scripts/set-repo.mjs https://github.com/<owner>/slopgate --write
```

It replaces the slug in `package.json`, README badges, the CLI help, SARIF metadata and CONTRIBUTING, and rewrites README's relative links to absolute URLs (npm renders the README without the rest of the repository, so relative links would 404 there).

## 0b. One-off historical backfill

The 19 stable published versions (0.1.0–0.1.18) predate the tag workflow, so they have no tags or GitHub releases. Run **Actions → Backfill labels and releases → Run workflow** once after this workflow reaches `main`. It:

- creates the `false-positive` and `precision` issue labels used by the false-positive issue template;
- creates tags and GitHub releases for the 19 published versions, mapped to the commit that carried that `package.json` version.

The workflow is idempotent (`gh release view` is checked first). Delete it after the backfill if you do not want to keep an admin-only workflow.

Do **not** create a release for `0.0.0-stage`: it is a staging npm publish with no matching commit. It is intentionally omitted. The npm versions `0.1.7` and `0.1.12` were published later from their actual commits (`a72cedc` and `93d4a90`) under the `legacy` dist-tag; `latest` remains 0.1.18.

Provenance cannot be added retroactively to these releases. npm attestations are created at publish time; only versions published by the CI workflow below will show the badge.

## 1. Pre-flight (on main)

```bash
npm ci
npm run verify      # typecheck + links + tests + build + self-scan + package contents
```

`npm run verify` must exit 0. It is the same set of gates CI runs.

- [ ] CI is green on `main`
- [ ] `CHANGELOG.md` has an entry for the new version
- [ ] README and `scripts/demo-frame.mjs` version references updated (covered by `test/docs.test.ts`)
- [ ] `package.json` version bumped (`npm version patch --no-git-tag-version`)
- [ ] Benchmark regenerated and not worse than the published number

```bash
# Run the full ten-corpus command from docs/benchmark.md (see Reproducing), then:
git diff benchmark/report.md benchmark/results.json benchmark/labels.json
```

The script reports stale labels and unlabeled high findings; both should be zero before a release. If precision dropped by more than two points, fix the rule or lower its confidence first.

## 2. Publish via tag

### 2a. Configure npm authentication

In GitHub: **Settings → Secrets and variables → Actions → New repository secret**:

```text
NPM_TOKEN = <granular npm token with publish access to @voidh4x0r/slopgate>
```

The workflow already declares `id-token: write`, which npm needs for provenance.

### 2b. Tag and push

```bash
git switch main
git pull --ff-only
git tag -a v0.1.19 -m "slopgate 0.1.19"
git push origin main
git push origin v0.1.19
```

Use the actual version number. The workflow file at that tag commit must already contain the idempotency guard; the tag is created after the release commit is on `main`.

If the workflow fails with `HTTP 403: Resource not accessible by integration`:

1. Open **Settings → Actions → General → Workflow permissions**, select **Read and write permissions**, and save. Re-run the failed workflow.
2. If organization policy blocks that setting, create a `RELEASE_TOKEN` secret (fine-grained PAT with **Contents: read/write** and **Issues: read/write** for this repository). The backfill and release workflows prefer `RELEASE_TOKEN` and fall back to `github.token`.

What happens:

1. `release.yml` checks out the tag, runs typecheck/tests/build.
2. It verifies that the tag matches `package.json`.
3. `npm view` checks whether the version already exists.
4. If missing, it runs `npm publish --provenance --access public`.
5. It creates the GitHub release if one does not already exist.

The guard makes reruns safe: if npm publish succeeded but the release step failed, re-run the workflow; publish is skipped and the release is created.

### 2c. Emergency local publish

Only if CI publishing is unavailable:

```bash
npm publish --access public
```

This does not produce provenance. Add a note to the GitHub release; do not pretend the version has an attestation.

## 3. Post-flight

- [ ] `npm view @voidh4x0r/slopgate version` shows the new version
- [ ] `npx @voidh4x0r/slopgate@0.1.19 --version` works on a clean machine
- [ ] GitHub release exists and its notes read correctly
- [ ] The provenance badge shows on the npm page (CI publish only)
- [ ] `false-positive` and `precision` labels exist (one-off backfill or repository settings)

## 4. If something breaks

`npm unpublish` is destructive and only works within 72 hours. Preferred recovery: publish a patch release immediately, and add a note to the GitHub release. For a security issue, open a GitHub security advisory first.

## Versioning

- **patch** — rule precision fixes, docs, dependencies
- **minor** — new rules, new output format, new CLI flag
- **major** — rule id rename, config schema break, breaking CLI/exit-code change

Before 1.0, a patch release may change an exit code when the previous behaviour silently hid a failure (for example, zero matched files used to exit 0); call it out explicitly in the changelog and the release notes.

Adding a rule is a minor release even though it may surface new findings; that is why `--write-baseline` and `--diff` exist.
