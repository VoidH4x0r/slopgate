# slopgate for VS Code

This extension surfaces [`slopgate`](https://github.com/VoidH4x0r/slopgate) diagnostics in VS Code. It does **not** reimplement any rule: it invokes the installed `slopgate` CLI with `--format json`.

## Setup

1. Install the CLI globally or in the workspace:

   ```bash
   npm install -D @voidh4x0r/slopgate
   ```

2. Install the extension (or run it from source).
3. If `slopgate` is not on `PATH`, set `slopgate.path` to the executable.

## Commands

- `slopgate: Scan workspace`
- `slopgate: Scan current file`
- `slopgate: Fix safe findings in current file`

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `slopgate.path` | `slopgate` | CLI executable |
| `slopgate.confidence` | `high` | Minimum confidence shown |
| `slopgate.failOn` | `none` | Passed to the CLI; the extension never fails a build |

## Design

- Diagnostics come from CLI JSON; rule logic stays in the CLI.
- Quick fixes are offered only for `py/unreachable` and `ts/unreachable`, the safe autofix subset.
- The extension reads the CLI's resolved `.slopgate.json`; it does not duplicate config parsing.
- No language server, no network access, no bundled grammars.

## Development

```bash
npm install
npm test
npm run build
```
