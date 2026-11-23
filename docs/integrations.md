# Integrations

`slopgate` is designed to be called from CI, pre-commit, editors and coding agents without reimplementing rules.

## GitHub Action

The repository ships a composite action in `action.yml`:

```yaml
- uses: VoidH4x0r/slopgate@v1.0.2
  with:
    path: .
    confidence: high
    fail-on: high
    version: "1.0.2"
```

`version: latest` uses the published npm package. Pin a version for reproducible CI. The action calls `npx --yes @voidh4x0r/slopgate@<version>`; it does not bundle the CLI.

## pre-commit

Add this to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/VoidH4x0r/slopgate
    rev: v1.0.2
    hooks:
      - id: slopgate
```

The hook scans the repository root with `--fail-on high` and does not pass individual filenames, because slopgate needs project context (manifests, imports, duplicate bodies).

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

- `scan_diff` - findings on changed lines;
- `scan_path` - findings under a path;
- `list_rules` - every rule and its defaults;
- `explain_rule` - one rule's metadata;
- `preview_fix` - safe fixes that `--fix` would apply, without writing.

## JSON Schema

`.slopgate.json` / `slopgate.config.json` can reference `schema/slopgate.schema.json` (published in the npm package) for editor completion and CI validation.

## VS Code

See `packages/slopgate-vscode/README.md`; the extension is CLI-backed and does not copy rule logic.
