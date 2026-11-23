# Encoding contract

This repository is UTF-8 only. The contract exists because a Windows tools round-trip once turned typographic characters into valid-looking CJK text, and the docs still passed every test.

## What happened

The separator `·` (U+00B7 MIDDLE DOT) is encoded in UTF-8 as `C2 B7`. CP936/GBK also has a valid character at `C2 B7`: U+8DEF. A tool that decoded the UTF-8 bytes as CP936 and then wrote the result back as UTF-8 therefore turned:

```text
slopgate 0.2.2  ·  4 files
```

into:

```text
slopgate 0.2.2  U+8DEF  4 files
```

No invalid byte was produced, so a UTF-8 decoder still accepted the file. Other punctuation was less lucky:

| Original | UTF-8 bytes | CP936 decode result |
| --- | --- | --- |
| U+00B7 | `C2 B7` | U+8DEF (valid, silent) |
| U+2502 | `E2 94 82` | U+9239 + invalid trailing byte |
| U+2014 | `E2 80 94` | U+9225 + invalid trailing byte |
| U+2192 | `E2 86 92` | U+922B + invalid trailing byte |
| U+2705 | `E2 9C 85` | U+9241 + invalid trailing byte |

The invalid trailing bytes became U+FFFD or a literal `?` depending on the tool. The U+00B7 case had no invalid byte at all, which is why it was the hardest to spot and why an earlier guard focused on U+8DEF.

## Why the old guard kept growing

The guard tried to answer "is this document Chinese, or is this mojibake?" from content alone. That question has no reliable answer:

- U+8DEF is a legitimate Chinese character and also the mojibake of U+00B7.
- A single Chinese example in an English document looks like a Chinese document to a density heuristic.
- A Chinese README with large code blocks looks like an English document to the same heuristic.
- Adding runs, markers, density thresholds, code-block stripping, and line-context rules only moved the false positives and false negatives around.

Content heuristics were the wrong layer. The repository should declare its language and encoding explicitly instead.

## Contract

1. **Text encoding.** Every text file is valid UTF-8, without a BOM, with LF line endings and a final newline.
2. **English documentation.** All `.md` files are English by default. They may only contain the typographic characters listed in `scripts/encoding-policy.json`.
3. **Localized documentation.** Chinese docs live under `docs/zh/` or use a `.zh.md`, `.zh-CN.md`, `.zh-Hans.md` or `.zh-Hant.md` suffix. Those files may contain arbitrary Unicode, but still must be valid UTF-8 without a BOM or U+FFFD.
4. **Code and tests.** Source and test files may contain any valid Unicode (for example, test strings); they are not subject to the English-docs whitelist.
5. **Intentional exceptions.** The BOM fixtures under `fixtures/regressions/` are listed in `bomAllowlist` because they deliberately test BOM tolerance. Any new exception must be narrow, named, and reviewed.

The policy is data, not code: see `scripts/encoding-policy.json`.

## Enforcement

`npm run check:encoding` walks the repository and checks every text file for:

- a UTF-8 BOM;
- a U+FEFF zero-width no-break space;
- a U+FFFD replacement character;
- invalid UTF-8;
- an unexpected non-ASCII character in an English `.md` file.

The check is part of `npm run verify`. CI runs it on Linux and Windows; the Windows job matters because the original corruption came from a Windows text pipeline.

The test suite also enforces the same policy in `test/docs-encoding.test.ts`. The test and the CLI checker share `scripts/encoding-policy.json`, so adding an allowed character is a single reviewed data change.

## Write boundary

The cheapest way to prevent this class of bug is to keep non-UTF-8 decoders out of the write path:

- Use the editor, the DSH write/edit tools, or Node `fs.writeFileSync(path, text, 'utf8')` for repository text.
- Do not use Windows PowerShell 5.1 `Set-Content`/`Out-File` or redirect `>` to rewrite UTF-8 docs. Its default code page can round-trip through the system ANSI code page.
- If PowerShell is unavoidable, use PowerShell 7 with `Set-Content -Encoding utf8NoBOM` and verify with `npm run check:encoding` before committing.
- Do not pipe UTF-8 files through tools that print to the console and read the text back; console encodings differ by host.

`.editorconfig` sets `charset = utf-8` and LF for editors that honour it. `.gitattributes` normalizes text to LF and marks binary assets.

## Adding a translation

1. Put the file under `docs/zh/` or name it `README.zh.md` (and the matching locale suffix).
2. Write it as UTF-8 with no BOM.
3. Run `npm run check:encoding`.
4. Do not add CJK examples to English docs. Describe them with code points (`U+8DEF`) or put them in the localized file.

## Recovery

If a doc edit looks wrong, do not try to repair the mojibake by re-encoding it in place. Restore the last known-good revision and replay only the intended content changes:

```powershell
git checkout <good-commit> -- README.md
```

That restores the exact bytes from the good commit. Replay only the intended content changes with a UTF-8-safe writer, then run `npm run check:encoding` and inspect `git diff` before committing. A byte-level restore from a good commit is deterministic; guessing which CJK sequence was which punctuation is not.

## What not to do

- Do not reject every CJK character in every file; translations are legitimate.
- Do not infer language from CJK density, run length, or a particular character such as U+8DEF.
- Do not add a new mojibake marker without adding a policy test and a recovery note.
- Do not treat `npm test` passing as proof that the bytes are correct; this incident was valid UTF-8 from start to finish.
