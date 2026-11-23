# MCP server

`slopgate mcp` speaks the [Model Context Protocol](https://modelcontextprotocol.io) over stdio. It lets a coding agent check its own work **before** it tells a human the task is done.

The server is intentionally small:

- it exposes only tools, not prompts, resources or sampling;
- it runs locally and makes no network calls;
- it reads the same `.slopgate.json`, baselines and manifests as the CLI;
- it never writes a file.

## Add it to a client

Claude Code (`~/.claude.json` or project `.mcp.json`):

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

Codex and other MCP clients use the same `command` + `args` pair. The optional argument after `mcp` is the repository root; it defaults to the current working directory.

Start the server from the repository root so baseline and report paths line up:

```bash
npx @voidh4x0r/slopgate mcp .
```

The server prints one line to stderr on startup:

```text
slopgate mcp 1.0.2 ready (root: /path/to/repo)
```

Nothing else is written except newline-delimited JSON-RPC messages on stdout.

## The loop it is designed for

```text
agent edits code
      v
scan_diff  ──→  findings on changed lines
      v
agent fixes exactly those findings
      v
scan_diff  ──→  clean (or the next small batch)
```

This is deliberately different from “run a full lint at the end”: the agent gets a short, line-anchored list while the change is still in context. A clean `scan_diff` is evidence that the new lines do not contain the structural shapes `slopgate` can prove; it is not a proof that the feature is correct.

## Tools

### `scan_diff`

```json
{
  "name": "scan_diff",
  "arguments": {
    "base": "origin/main",
    "confidence": "high",
    "maxFindings": 20
  }
}
```

Scans the repository and keeps a finding when its `start..end` range intersects a line added since `base` (default `HEAD`). Untracked files count as fully changed. This is the tool an agent should call before finishing a task.

`base` is passed through the same safe-ref validation as `--diff`; option-shaped values and control characters are rejected.

### `scan_path`

```json
{
  "name": "scan_path",
  "arguments": {
    "path": "src/",
    "confidence": "medium"
  }
}
```

Scans a file or directory inside the repository root. A path outside the root, a non-string path, or a scan that matches zero files is returned as a tool error, so an agent cannot mistake a typo for a clean result.

Paths are relative to the MCP server root. Point the server at the repository root and select subdirectories with `scan_path`; do not start a separate server at the subdirectory unless you also want a separate baseline and config boundary.

### `list_rules`

Returns the rule table: `id`, `severity`, default `confidence`, `languages` and `title`. This is what lets an agent know what was checked instead of assuming that “no findings” means “no rules applied”.

### `explain_rule`

```json
{ "name": "explain_rule", "arguments": { "ruleId": "go/noop-test" } }
```

Returns one rule's title, summary, severity, default confidence, languages and tags. Unknown rule ids are returned as a tool error.

### `preview_fix`

```json
{ "name": "preview_fix", "arguments": { "path": "src/", "confidence": "high" } }
```

Shows the safe fixes that `--fix` would apply under the path, **without writing any file**. The safe subset is unreachable code after `return` / `raise` / `break` / `continue`. This tool reads and parses files; it does not spawn a process.

## Response format

`tools/call` returns a standard MCP text result:

```text
Diff since origin/main: 2 finding(s) on changed lines.
slopgate 1.0.2 · 2 finding(s) (1 error) · 38 files scanned in 214ms
src/users.py:12:5  error  high  py/phantom-import  `requests_v2` is imported but not declared…
    import requests_v2
    - no Python dependency manifest found
```

Output is capped at 50 findings per call (`maxFindings`), configurable down to 1. Findings are ordered deterministically: file, line, column, rule id.

When there are no findings, the result still reports what was scanned:

```text
Diff since origin/main: no findings on changed lines.
slopgate 1.0.2 · 0 finding(s) · 38 files scanned in 204ms
```

`scan_path` and `scan_diff` return `isError: true` when zero files match. This is intentional: an over-broad `exclude` should not look like a clean repository.

## Behaviour

- **Configuration**: `.slopgate.json` is resolved for each requested path using the same nearest-config search as the CLI (target → ancestors → repository root).
- **Baseline**: if `.slopgate-baseline.json` exists, findings recorded in it are not returned, so an agent is not nagged about accepted debt. Baseline paths are mapped to the repository root even when scanning a subdirectory.
- **Confidence**: defaults to the resolved config's `confidence` (usually `high`); `medium` and `low` are opt-in per call.
- **Paths**: findings are reported relative to the MCP server root, so `scan_path { path: "packages/app" }` reports `packages/app/app.py`.
- **Failures**: a scan error becomes a tool result with `isError: true`, never a crashed server.
- **Exit code**: the process exits 0 when stdin closes.
- **State**: the registry is rebuilt per scan, so a file created by the agent is visible without restarting the server.

## Protocol details

- JSON-RPC 2.0, newline-delimited, over stdio.
- Requests must include `jsonrpc: "2.0"`. A missing or invalid version is `-32600`.
- A request without `id` is a notification and receives no response; `id: null` is a request.
- A batch array is accepted and produces an array of responses; notifications are omitted.
- The server negotiates known MCP protocol versions and falls back to its default when the client requests an unknown one.
- Only the `tools` capability is implemented.
- `tools/call` arguments must be an object; arrays and scalars are rejected with `-32602`.
- `maxFindings` must be a positive integer; fractional values are rejected rather than silently truncated.

## Manual test

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"scan_path","arguments":{}}}' \
  | npx @voidh4x0r/slopgate mcp .
```

## Limitations

- stdio transport only. No SSE or HTTP endpoint.
- `scan_diff` needs `git` on `PATH` and a sandbox that permits child processes; plain `scan_path` and `list_rules` do not spawn anything.
- The MCP result is a text summary, not a full JSON document; use `--format json` when you need every field.
- The MCP server does not expose the `--fix` write path. It can preview fixes, but the human or agent must apply the actual edit.
