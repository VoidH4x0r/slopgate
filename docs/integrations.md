# Integrations

`slopgate` is designed to be called from CI, pre-commit, editors and coding agents. Every integration runs the same CLI and the same rules; none of them reimplement detection.

## GitHub Action

The repository ships a composite action in [`action.yml`](https://github.com/VoidH4x0r/slopgate/blob/main/action.yml):

```yaml
name: slopgate
on: [push, pull_request]

jobs:
  slopgate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: VoidH4x0r/slopgate@v1.0.2
        with:
          path: .
          confidence: high
          fail-on: high
          version: "1.0.2"
```

`version: latest` uses the published npm package. Pin a version for reproducible CI. The action calls `npx --yes @voidh4x0r/slopgate@<version>`; it does not bundle the CLI. The runner must have Node.js available (the GitHub-hosted Ubuntu/Windows images do).

### Full workflow with a baseline

For a repository with existing debt, record the baseline once and commit it:

```yaml
name: slopgate
on: [push, pull_request]

permissions:
  contents: read

jobs:
  slopgate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22 }
      - run: npx --yes @voidh4x0r/slopgate@1.0.2 . --fail-on high --no-color
```

The committed `.slopgate-baseline.json` is read automatically. New findings on changed code still fail; accepted debt does not.

### Only changed lines

`--diff` is the lowest-friction adoption path for a large repository:

```yaml
      - run: |
          git fetch origin "${{ github.base_ref }}" --depth=1
          npx --yes @voidh4x0r/slopgate@1.0.2 . \
            --diff "origin/${{ github.base_ref }}" \
            --fail-on high \
            --format github
```

This requires a real git history; `actions/checkout` defaults to a shallow clone, so fetch the base branch when needed.

## GitHub code scanning (SARIF)

```yaml
name: slopgate-sarif
on: [push, pull_request]

permissions:
  contents: read
  security-events: write

jobs:
  slopgate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22 }
      - run: npx --yes @voidh4x0r/slopgate@1.0.2 . --format sarif --fail-on high > slopgate.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: slopgate.sarif
```

SARIF 2.1.0 output includes the driver, rule metadata and one result per finding with a physical location. The upload step is useful even when the scan step fails; `if: always()` preserves the diagnostics.

## Inline PR annotations (no code scanning)

`--format github` emits workflow commands directly:

```yaml
      - run: npx --yes @voidh4x0r/slopgate@1.0.2 . --format github --fail-on high
```

Each finding becomes an `error` / `warning` / `notice` annotation on the cited line, followed by a summary notice. This works on pull requests from forks without a security-events permission.

## pre-commit

Add this to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/VoidH4x0r/slopgate
    rev: v1.0.2
    hooks:
      - id: slopgate
```

The hook scans the repository root with `--fail-on high` and does not pass individual filenames, because `slopgate` needs manifests, import graphs and cross-file duplicate bodies to make its decisions. Passing one file would silently change the semantics of the checks.

If the hook is too slow for every commit, keep it in CI and run it manually before larger reviews.

## MCP

```json
{
  "mcpServers": {
    "slopgate": {
      "command": "npx",
      "args": ["-y", "@voidh4x0r/slopgate", "mcp"]
    }
  }
}
```

Tools:

- `scan_diff` — findings on changed lines;
- `scan_path` — findings under a path;
- `list_rules` — every rule and its defaults;
- `explain_rule` — one rule's metadata;
- `preview_fix` — safe fixes that `--fix` would apply, without writing.

The server uses stdio, runs locally and makes no network calls. Full protocol details are in [mcp.md](mcp.md).

## VS Code

The independent extension lives in [`packages/slopgate-vscode`](https://github.com/VoidH4x0r/slopgate/tree/main/packages/slopgate-vscode). It invokes the installed CLI with `--format json`, publishes diagnostics, and offers quick fixes for the safe unreachable-code subset.

It supports multiple workspace folders, resolves `slopgate.*` settings per folder, and never reimplements a rule. Install the CLI in the workspace or globally; set `slopgate.path` if it is not on `PATH`.

## JSON Schema

`.slopgate.json` / `slopgate.config.json` can reference the published schema:

```json
{
  "$schema": "https://raw.githubusercontent.com/VoidH4x0r/slopgate/main/schema/slopgate.schema.json"
}
```

Editors get completion for `include`, `exclude`, `ignoreModules`, `rules`, `confidence` and `failOn`; CI gets validation for unknown keys. The scan output schema is `schema/scan-output.schema.json`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | no findings at or above `--fail-on` |
| 1 | findings at or above `--fail-on` |
| 2 | usage/configuration error, git failure, rule crash, or zero files matched |

`--fail-on none` still returns 2 if a rule crashed: a scan that did not complete should never look clean.

## Adoption order that works

1. Run `slopgate . --write-baseline` and commit `.slopgate-baseline.json`.
2. Add `slopgate . --fail-on high` as a non-blocking job for one week; inspect the new findings.
3. Make it required once the team agrees on the signal.
4. Add `--diff origin/main` for very large repos, or keep the baseline for everything.
5. Add MCP for agents and the VS Code extension for reviewers.

The baseline and diff modes are not a way to hide problems; they are a way to stop new problems while existing debt is paid down deliberately.
