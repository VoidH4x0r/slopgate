# Third-party notices

`slopgate` is MIT licensed. It bundles the following MIT-licensed components:

## Runtime

- [`web-tree-sitter`](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web) - MIT.
- `tree-sitter` runtime - MIT.

## Bundled grammars

The `.wasm` parsers in `grammars/` are vendored from the tree-sitter grammar repositories:

| File | Upstream | License |
| --- | --- | --- |
| `tree-sitter-python.wasm` | tree-sitter/tree-sitter-python | MIT |
| `tree-sitter-typescript.wasm` | tree-sitter/tree-sitter-typescript | MIT |
| `tree-sitter-tsx.wasm` | tree-sitter/tree-sitter-typescript | MIT |
| `tree-sitter-go.wasm` | tree-sitter/tree-sitter-go | MIT |
| `tree-sitter-rust.wasm` | tree-sitter/tree-sitter-rust | MIT |

The grammar repositories carry their own MIT license files. This notice is a summary, not a replacement for those licenses. See `grammars/README.md` for provenance and the exact prebuilt source.
