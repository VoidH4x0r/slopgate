# Release checklist

The release workflow (`.github/workflows/release.yml`) publishes on a `v*` tag. Nothing is published from a laptop.

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
- [ ] `package.json` version bumped
- [ ] Benchmark regenerated and not worse than the published number

```bash
node scripts/benchmark.mjs --corpus cpython=/path/to/cpython/Lib
git diff benchmark/report.md
```

If precision dropped by more than two points, fix the rule or lower its confidence before releasing.

## 2. Tag and push

```bash
git tag -a v0.1.0 -m "slopgate 0.1.0"
git push origin main --follow-tags
```

The workflow verifies that the tag matches `package.json`, runs the suite, publishes to npm with provenance, and creates a GitHub release.

## 3. Post-flight

- [ ] `npm view @voidh4x0r/slopgate version` shows the new version
- [ ] `npx @voidh4x0r/slopgate@0.1.0 --version` works on a clean machine
- [ ] GitHub release notes read correctly
- [ ] The provenance badge shows on the npm page

## 4. If something breaks

`npm unpublish` is destructive and only works within 72 hours. Preferred recovery: publish a patch release immediately, and add a note to the GitHub release. For a security issue, open a GitHub security advisory first.

## Versioning

- **patch** — rule precision fixes, docs, dependencies
- **minor** — new rules, new output format, new CLI flag
- **major** — rule id rename, config schema break, exit code change

Adding a rule is a minor release even though it may surface new findings; that is why `--write-baseline` and `--diff` exist.
