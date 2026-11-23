# slopgate for VS Code

**Version 0.1.1.** This extension surfaces [`slopgate`](https://github.com/VoidH4x0r/slopgate) diagnostics inside VS Code. It does **not** reimplement a rule: it invokes the installed `slopgate` CLI with `--format json` and renders the result.

## Why a CLI-backed extension?

The CLI already knows how to resolve manifests, tsconfig aliases, `go.work`, Cargo workspaces and baselines. Duplicating that logic in an editor extension would inevitably drift. The extension stays a thin, predictable adapter:

- rules and confidence live in the CLI;
- diagnostics are the CLI's exact output, with the same paths and evidence;
- quick fixes are limited to the safe unreachable-code subset;
- no language server, no bundled grammars, no network access.

## Setup

1. Install and run the CLI once:

   ```bash
   npm install -D @voidh4x0r/slopgate
   npx @voidh4x0r/slopgate .
   ```

2. Install the extension.
3. If `slopgate` is not on `PATH`, set `slopgate.path` (for example `node_modules/.bin/slopgate` or an absolute path).

The extension works in trusted workspaces only. It never installs packages or starts a daemon.

## Commands

| Command | What it does |
| --- | --- |
| `slopgate: Scan workspace` | scans every workspace folder, publishing diagnostics per folder |
| `slopgate: Scan current file` | scans the active file and refreshes its diagnostics |
| `slopgate: Fix safe findings in current file` | runs `--fix` for unreachable code, then rescans |

All commands appear in the Command Palette. The save-triggered scan is opt-in via `slopgate.scanOnSave`.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `slopgate.path` | `slopgate` | CLI executable; resolved with `cross-spawn`, no shell |
| `slopgate.confidence` | `high` | minimum confidence shown |
| `slopgate.failOn` | `none` | passed to the CLI; the extension never fails a build |
| `slopgate.scanOnSave` | `true` | rescan the saved supported file |

Settings resolve per workspace folder, so a monorepo can set a stricter policy for one package. `slopgate.path` may be a workspace-relative path or an absolute path.

## Multi-root workspaces

`Scan workspace` walks every folder in the workspace and publishes findings under the folder that owns the file. Duplicate diagnostics are removed by URI, and a scan from a newer request cannot overwrite the result of a newer one. Deleting or renaming a file clears its old diagnostics; changing the workspace folder list clears stale state and triggers a rescan.

## Quick fixes

Quick fixes are offered only for `py/unreachable` and `ts/unreachable`, the same safe subset as `slopgate --fix`. The extension validates the original document version before applying an edit; if the file changed while the scan was in flight, the fix is discarded rather than applied to the wrong text.

## Development

```bash
cd packages/slopgate-vscode
npm install
npm test
npm run typecheck
npm run build
```

The extension has its own `package.json` and lockfile. It is versioned independently from the CLI; the current version is **0.1.1**.

## Troubleshooting

**“slopgate: command not found”** — install the CLI or set `slopgate.path` to `node_modules/.bin/slopgate`.

**No diagnostics on a supported file** — check `slopgate.confidence`; a `medium` finding is hidden at the default `high`. Run `slopgate: Scan current file` and inspect the `slopgate` output channel.

**Findings point at a different workspace folder** — findings are relative to the CLI's `reportRoot`. The extension maps them back through `reportRoot`; verify that the workspace folder and CLI root are consistent.
