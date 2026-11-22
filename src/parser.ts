import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser } from 'web-tree-sitter';
import type { LanguageId } from './types.ts';

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const GRAMMARS: Readonly<Record<LanguageId, string>> = {
  python: 'tree-sitter-python.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
};

let initPromise: Promise<void> | undefined;
const parserCache = new Map<LanguageId, Promise<Parser>>();

async function ensureRuntime(): Promise<void> {
  initPromise ??= Parser.init();
  await initPromise;
}

function grammarPath(language: LanguageId): string {
  return path.join(PACKAGE_ROOT, 'grammars', GRAMMARS[language]);
}

export async function getParser(language: LanguageId): Promise<Parser> {
  const cached = parserCache.get(language);
  if (cached) return cached;

  const created = (async () => {
    await ensureRuntime();
    const wasm = grammarPath(language);
    let lang: Language;
    try {
      lang = await Language.load(wasm);
    } catch (error) {
      throw new Error(
        `could not load grammar for ${language} (${wasm}). ` +
          'If you installed from source, run `npm install` first. ' +
          `Underlying error: ${(error as Error).message}`,
      );
    }
    const parser = new Parser();
    parser.setLanguage(lang);
    return parser;
  })();

  parserCache.set(language, created);
  return created;
}
