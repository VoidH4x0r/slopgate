# Documentation map

Start with the [README](../README.md) for the product story and a 60-second example. This page is the index for the details.

## I want to…

| Goal | Read |
| --- | --- |
| Understand what it catches and why | [README: What it catches](../README.md#what-it-catches) |
| See how the scan works | [README: How it works](../README.md#how-it-works) |
| Adopt it on a legacy repository | [README: Adopting it on an existing repository](../README.md#adopting-it-on-an-existing-repository) |
| Audit AI-generated code at `medium` | [README: Auditing AI-written code](../README.md#auditing-ai-written-code) |
| Look up a rule, example or counterexample | [Rule reference](rules.md) |
| Configure `.slopgate.json` | [README: Configuration](../README.md#configuration) and [config schema](https://github.com/VoidH4x0r/slopgate/blob/main/schema/slopgate.schema.json) |
| Suppress a finding | [README: Suppressing a finding](../README.md#suppressing-a-finding) |
| Run it in CI or pre-commit | [Integrations](integrations.md) |
| See the automated quality and security gates | [Quality gates](quality-gates.md) |
| Let an agent self-check over MCP | [MCP server](mcp.md) |
| Use the VS Code extension | [VS Code extension](https://github.com/VoidH4x0r/slopgate/blob/main/packages/slopgate-vscode/README.md) |
| Use the programmatic API | [Public contract](contract.md) |
| Understand the benchmark and labels | [Benchmark methodology](benchmark.md) |
| Check text/encoding rules | [Encoding contract](encoding.md) |
| See where the project is going | [Roadmap](roadmap.md) |
| Read the Chinese guide | [Chinese guide](zh/README.md) |

## Reference

- [Rule reference](rules.md) — 32 rules, confidence boundaries and negative cases.
- [Public contract](contract.md) — stable exports, config keys, finding fields, SARIF, MCP and exit codes.
- [JSON output schema](https://github.com/VoidH4x0r/slopgate/blob/main/schema/scan-output.schema.json) and [config schema](https://github.com/VoidH4x0r/slopgate/blob/main/schema/slopgate.schema.json).
- [Benchmark methodology](benchmark.md) — corpus digests, labels, false positives and reproduction commands.
- [Integrations](integrations.md) — GitHub Action, SARIF, annotations, pre-commit, MCP, VS Code.
- [Quality gates](quality-gates.md) — coverage thresholds, CodeQL, dependency review, pinned Actions and the weekly benchmark.
- [MCP server](mcp.md) — tools, protocol details and the agent loop.
- [Encoding contract](encoding.md) — UTF-8/BOM, English docs whitelist and CJK safeguards.
- [Roadmap](roadmap.md) — product thesis, release history and remaining risks.
- [Release checklist](../RELEASE.md) and [security policy](../SECURITY.md).
- [Contributing](../CONTRIBUTING.md) — architecture, rule template and review expectations.

## Conventions

- **Finding** is a single reported problem with a rule id, severity, confidence, file position, message, snippet, evidence and optional help.
- **Severity** is what the finding means (`error`, `warning`, `info`); **confidence** is how sure the rule is (`high`, `medium`, `low`). Only `high` is displayed by default and fails CI by default.
- **Baseline** accepts existing debt by fingerprint; **diff** limits the scan to changed lines. Both are adoption tools, not a way to hide new problems.
- **Test files** are deliberately skipped by rules where test scaffolding is intentional; `noop-test` and `tautological-assert` are the rules that inspect tests.
- **Generated files** are recognized only in a header (Go/Rust), never by a string in the middle of a file.
