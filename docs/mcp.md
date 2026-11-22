# MCP server

`slopgate mcp` speaks the [Model Context Protocol](https://modelcontextprotocol.io) over stdio, so a coding agent can lint its own work instead of waiting for a human review.

## Add it to a client

Claude Code (`~/.claude.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "slopgate": { "command": "npx", "args": ["-y", "@voidh4x0r/slopgate", "mcp"] }
  }
}
```

Codex and other MCP clients use the same `command` + `args` pair. The optional argument after `mcp` is the repository root; it defaults to the current working directory.

The server prints a single line to stderr on startup (`slopgate mcp 0.2.8 ready (root: …)`). Nothing else is written except JSON-RPC messages on stdout.

## Tools

### `scan_diff`

```json
{ "name": "scan_diff", "arguments": { "base": "origin/main", "confidence": "high", "maxFindings": 20 } }
```

Scans the repository and keeps a finding when its `start..end` range intersects a line added since `base` (default `HEAD`). Untracked files count as fully changed. This is the tool an agent should call before finishing a task.

### `scan_path`

```json
{ "name": "scan_path", "arguments": { "path": "src/", "confidence": "medium" } }
```

Scans a file or directory inside the repository root. A path outside the root, or a scan that matches zero files, is returned as a tool error so an agent cannot mistake a typo for a clean result.

Scans a file or directory relative to the repository root. Paths that escape the root are refused.

### `list_rules`

Returns the rule table (id, severity, default confidence, languages, title) so the agent can reason about what was checked.

## Response format

`tools/call` returns a standard MCP text result:

```text
Diff since origin/main: 2 finding(s) on changed lines.
slopgate 0.2.8 · 2 finding(s) (1 error) · 38 files scanned in 214ms
src/users.py:12:5  error  high  py/phantom-import  `requests_v2` is imported but not declared…
    import requests_v2
    - no Python dependency manifest found
```

Output is capped at 50 findings per call (`maxFindings`), configurable down to 1.

## Behaviour

- **Configuration**: `.slopgate.json` is resolved for each requested path using the same nearest-config search as the CLI (target → ancestors → repository root).
- **Baseline**: if `.slopgate-baseline.json` exists, findings recorded in it are not returned, so an agent is not nagged about accepted debt.
- **Confidence**: defaults to the resolved config’s `confidence` (usually `high`); `medium` and `low` are opt-in per call.
- **Paths**: findings are reported relative to the MCP server root, so `scan_path { path: "packages/app" }` reports `packages/app/app.py`. The MCP root must be the repository root; select subdirectories with `scan_path` rather than pointing the server at them.
- **Failures**: a scan error becomes a tool result with `isError: true`, never a crashed server.
- **Exit code**: the process exits 0 when stdin closes.

## Manual test

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"scan_path","arguments":{}}}' \
  | npx @voidh4x0r/slopgate mcp .
```

## Limitations

- Only the `tools` capability is implemented; no prompts, resources or sampling.
- stdio transport only. No SSE or HTTP endpoint.
- `scan_diff` needs `git` on `PATH` and a sandbox that permits child processes; the plain `scan_path` and `list_rules` tools do not spawn anything.
- `scan_path` and `scan_diff` return `isError: true` when zero files match, so a typo or an over-broad `exclude` cannot look like a clean result.
