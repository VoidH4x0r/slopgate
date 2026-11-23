# Bundled grammars

These `.wasm` files are tree-sitter parsers compiled for the [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web) runtime, vendored so that `slopgate` works offline and without a build step.

| File | Upstream | License |
| --- | --- | --- |
| `tree-sitter-python.wasm` | [tree-sitter/tree-sitter-python](https://github.com/tree-sitter/tree-sitter-python) | MIT |
| `tree-sitter-typescript.wasm` | [tree-sitter/tree-sitter-typescript](https://github.com/tree-sitter/tree-sitter-typescript) | MIT |
| `tree-sitter-tsx.wasm` | [tree-sitter/tree-sitter-typescript](https://github.com/tree-sitter/tree-sitter-typescript) | MIT |
| `tree-sitter-go.wasm` | [tree-sitter/tree-sitter-go](https://github.com/tree-sitter/tree-sitter-go) | MIT |
| `tree-sitter-rust.wasm` | [tree-sitter/tree-sitter-rust](https://github.com/tree-sitter/tree-sitter-rust) | MIT |

(Tree-sitter itself is MIT licensed; the grammars carry their own MIT licenses, reproduced by their upstream repositories.)

We use the prebuilt artifacts from [`tree-sitter-wasms`](https://www.npmjs.com/package/tree-sitter-wasms). The TypeScript grammar is also used for plain JavaScript, and the TSX grammar for `.jsx` / `.tsx`.

## Why vendored

Vendoring makes the published package self-contained: `npx @voidh4x0r/slopgate` works on a clean machine with no compiler, no `apt` step and no network fetch during a scan. It also makes the exact parser version auditable in the package contents.

## Compatibility

`web-tree-sitter` is pinned to `0.25.x` in `package.json`. Newer runtimes (0.26+) load grammars built with a different dynamic-linking convention and currently reject these files — that is why the dependency is pinned rather than ranged. If you upgrade the runtime, re-verify grammar loading before publishing.

## Updating a grammar

```bash
npm pack tree-sitter-wasms
tar -xzf tree-sitter-wasms-*.tgz
cp package/out/tree-sitter-python.wasm grammars/
cp package/out/tree-sitter-typescript.wasm grammars/
cp package/out/tree-sitter-tsx.wasm grammars/
cp package/out/tree-sitter-go.wasm grammars/
cp package/out/tree-sitter-rust.wasm grammars/
npm test
```
