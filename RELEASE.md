# Release checklist

Two supported paths:

- **Local publish (default today):** `npm publish` from a verified checkout. The `NPM_TOKEN` secret is not configured yet.
- **CI publish (after setup):** add an `NPM_TOKEN` repository secret, then a `v*` tag lets `.github/workflows/release.yml` verify the version, run the suite, publish with provenance and create the GitHub release. Without the secret a tag run skips publish/release with a warning instead of failing.

## 0. Repository slug (already done for this repository)

This repository already points at `https://github.com/VoidH4x0r/slopgate`; `package.json`, badges, CLI help, SARIF metadata and README links are absolute. The step below is only needed for a fork or a fresh scaffold:

```bash
node scripts/set-repo.mjs https://github.com/<owner>/slopgate --write
```

It replaces the slug in `package.json`, README badges, the CLI help, SARIF metadata and CONTRIBUTING, and rewrites README's relative links to absolute URLs (npm renders the README without the rest of the repository, so relative links would 404 there).

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
# Run the full ten-corpus command from docs/benchmark.md (§ Reproducing), then:
git diff benchmark/report.md benchmark/results.json benchmark/labels.json
```

The script reports stale labels and unlabeled high findings; both should be zero before a release. If precision dropped by more than two points, fix the rule or lower its confidence first.

## 2. Publish

### 2a. Local publish (default)

```bash
npm publish --access public          # add --otp=123456 if 2FA prompts
```

Requires an authenticated npm session (`npm login`) or a short-lived granular token:

```bash
npm config set //registry.npmjs.org/:_authToken "npm_..."
npm publish --access public
npm config delete //registry.npmjs.org/:_authToken
```

### 2b. CI publish (after adding NPM_TOKEN)

```bash
git tag -a v0.1.9 -m "slopgate 0.1.9"
git push origin main --follow-tags
```

Only do this once the repository secret exists. Without it the workflow still validates the tag and tests, then skips publish and release with a warning.

## 3. Post-flight

- [ ] `npm view @voidh4x0r/slopgate version` shows the new version
- [ ] `npx @voidh4x0r/slopgate@0.1.9 --version` works on a clean machine
- [ ] GitHub release notes read correctly (if the tag path was used)
- [ ] The provenance badge shows on the npm page (CI publish only)

## 4. If something breaks

`npm unpublish` is destructive and only works within 72 hours. Preferred recovery: publish a patch release immediately, and add a note to the GitHub release. For a security issue, open a GitHub security advisory first.

## Versioning

- **patch** — rule precision fixes, docs, dependencies
- **minor** — new rules, new output format, new CLI flag
- **major** — rule id rename, config schema break, breaking CLI/exit-code change

Before 1.0, a patch release may change an exit code when the previous behaviour silently hid a failure (for example, zero matched files used to exit 0); call it out explicitly in the changelog and the release notes.

Adding a rule is a minor release even though it may surface new findings; that is why `--write-baseline` and `--diff` exist.
