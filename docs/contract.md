# Stable public contract

`slopgate` 1.0 treats the following as a semantic contract. Additive changes are minor releases; removing or changing meaning requires a major release.

## Programmatic API

```ts
import { scanProject, CONTRACT_VERSION } from '@voidh4x0r/slopgate';
```

Stable exports:

- `scanProject(options)`;
- `applyFixes(fixes, { write })`;
- `DEFAULT_CONFIG`, `loadConfig`, `normalizeConfig`;
- `ALL_RULE_METAS`, `ALL_RULE_BY_ID`, `PROJECT_RULES`;
- types `Config`, `Finding`, `RuleMeta`, `RuleDraft`, `ScanFix`, `ScanStats`;
- `CONTRACT_VERSION` (currently `1`).

The CLI (`dist/cli.js`) remains the primary interface.

## Rule ids

Rule ids are stable and use the `<language>/<kebab-name>` format. Languages are `py`, `ts`, `go` and `rs`. The authoritative list is `ALL_RULE_METAS`; the README rule table and `docs/rules.md` must stay in sync.

## Config keys

`.slopgate.json` / `slopgate.config.json` accepts exactly:

- `$schema` (ignored meta key);
- `include`, `exclude`, `ignoreModules` (arrays of strings);
- `rules` (object of rule id to `off` / `error` / `warning` / `info`);
- `confidence` (`high` / `medium` / `low`);
- `failOn` (`high` / `medium` / `low` / `none`).

Unknown keys are a configuration error (exit 2). The JSON schema is `schema/slopgate.schema.json`.

## Finding and JSON fields

Each finding has:

```ts
{
  ruleId: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  confidence: 'high' | 'medium' | 'low';
  file: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
  snippet: string;
  evidence: string[];
  help?: string;
}
```

`--format json` wraps findings in:

```ts
{ tool: 'slopgate', version: string, findings: Finding[], stats: ScanStats }
```

The machine schema is `schema/scan-output.schema.json` (published in the npm package). Positions are 1-based. Paths are relative to the repository/report root.

## SARIF

SARIF 2.1.0 output includes `runs[0].tool.driver.name = "slopgate"`, rules under `tool.driver.rules`, and one result per finding with `ruleId`, `level`, `message.text`, `locations[0].physicalLocation.artifactLocation.uri` and `region.startLine/startColumn/endLine/endColumn`.

## MCP

Stable methods:

- `initialize`, `tools/list`, `tools/call`;
- tools: `scan_diff`, `scan_path`, `list_rules`, `explain_rule`, `preview_fix`.

The transport is newline-delimited JSON-RPC 2.0 over stdio; stdout contains protocol messages only.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | no findings at or above `--fail-on` |
| 1 | findings at or above `--fail-on` |
| 2 | usage/configuration error, git failure, or zero files matched |

## Compatibility

- Node 20, 22 and 24 are supported.
- Linux and Windows are supported; CI runs both.
- Rule behaviour may improve in a minor version, but a rule id and its meaning do not change without a major version.
- The `high` confidence gate and default `failOn: high` are part of the contract.
- Release publishing is tag-driven via `.github/workflows/release.yml`; `npm run release:check` validates the version, changelog and benchmark versions before publish.
