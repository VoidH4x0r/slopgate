# Security policy

## Supported versions

Security fixes are applied to the latest **1.x** release line. The latest published npm release is `1.0.4`; `1.0.2` is retained only as historical metadata.

| Version | Supported |
| --- | --- |
| 1.0.x | yes |
| < 1.0 | no |

## Reporting a vulnerability

Please **do not open a public issue** for a vulnerability. Use GitHub's private vulnerability reporting:

<https://github.com/VoidH4x0r/slopgate/security/advisories/new>

Include, when possible:

- affected version and platform;
- a minimal repository or input that reproduces the issue;
- the expected and actual behavior;
- whether the issue requires a malicious repository, a malicious config, or a malicious MCP client.

You should receive an acknowledgement within a few business days. We will coordinate a fix and a disclosure date with you.

## Accidental secret in a commit

If a credential, token or private key is ever committed:

1. **Revoke or rotate it first.** Treat the value as compromised as soon as it reaches a remote.
2. Report the incident privately through the advisory link above.
3. Do not rewrite public history alone; coordinate with the maintainer so mirrors, forks and CI caches are handled consistently.
4. Add a regression case or ignore rule so the same artifact cannot be staged again.

## What counts as a vulnerability

- arbitrary code execution through a scanned file, config, grammar or MCP message;
- escaping the scan root or reading arbitrary files through path handling;
- command injection through a path, ref, executable setting or CLI argument;
- MCP protocol handling that lets an untrusted client corrupt the server or write files;
- a packaged artifact that does not match the published source.

Ordinary false positives, rule disagreements and performance issues are **not** security vulnerabilities; report them through normal issues.

## Security model

- Scans run locally. There are no API keys, no telemetry and no network calls at scan time.
- `--diff` and MCP `scan_diff` invoke `git`; the ref is validated before use.
- The VS Code extension spawns the CLI through `cross-spawn` without a shell.
- MCP is stdio-only and read-only: `preview_fix` does not write, and there is no MCP write tool.
- The package ships the grammars and never downloads a grammar at runtime.
- `--fix` writes only files under the scan target, after a tree-sitter parse validation; keep the target under version control and review the diff.
