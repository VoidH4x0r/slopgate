import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asAst } from '../src/ast.ts';
import { DEFAULT_CONFIG, type Config } from '../src/config.ts';
import { scanProject, type ScanResult } from '../src/engine.ts';
import { getParser } from '../src/parser.ts';
import { collectCommentRanges } from '../src/rules/helpers.ts';
import { RULE_BY_ID } from '../src/rules/index.ts';
import type { LanguageId, ProjectDeps, RuleContext, RuleDraft } from '../src/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const FIXTURES = path.join(ROOT, 'fixtures');

export interface DepsOverrides {
  pythonDeclared?: string[];
  pythonLocal?: string[];
  pythonManifests?: string[];
  nodeDeclared?: string[];
  nodeInstalled?: string[];
  nodeAliases?: string[];
  nodeWorkspaces?: string[];
  hasPackageJson?: boolean;
  goModule?: string;
  goRequires?: string[];
  goManifests?: string[];
  rustCrate?: string;
  rustDependencies?: string[];
  rustLocal?: string[];
  rustManifests?: string[];
  ignored?: string[];
}

export function makeDeps(overrides: DepsOverrides = {}): ProjectDeps {
  return {
    root: FIXTURES,
    python: {
      declared: new Set(overrides.pythonDeclared ?? []),
      manifests: overrides.pythonManifests ?? [],
      localModules: new Set(overrides.pythonLocal ?? []),
    },
    node: {
      declared: new Set(overrides.nodeDeclared ?? []),
      workspaces: new Set(overrides.nodeWorkspaces ?? []),
      aliases: overrides.nodeAliases ?? [],
      hasPackageJson: overrides.hasPackageJson ?? true,
      installed: new Set(overrides.nodeInstalled ?? []),
    },
    go: {
      ...(overrides.goModule ? { module: overrides.goModule } : {}),
      requires: new Set(overrides.goRequires ?? []),
      manifests: overrides.goManifests ?? [],
    },
    rust: {
      ...(overrides.rustCrate ? { crateName: overrides.rustCrate } : {}),
      dependencies: new Set(overrides.rustDependencies ?? []),
      localModules: new Set(overrides.rustLocal ?? []),
      manifests: overrides.rustManifests ?? [],
    },
    ignoredModules: new Set(overrides.ignored ?? []),
  };
}

export async function contextFor(
  source: string,
  language: LanguageId,
  deps: ProjectDeps = makeDeps(),
  file = language === 'python' ? 'sample.py' : 'sample.ts',
): Promise<RuleContext> {
  const parser = await getParser(language);
  const tree = parser.parse(source);
  if (!tree) throw new Error('parser returned null');
  const root = asAst(tree.rootNode);
  return {
    file,
    source,
    lines: source.split(/\r?\n/),
    root,
    language,
    deps,
    comments: collectCommentRanges(root),
  };
}

export async function runRule(
  ruleId: string,
  source: string,
  language: LanguageId,
  deps: ProjectDeps = makeDeps(),
): Promise<RuleDraft[]> {
  const rule = RULE_BY_ID.get(ruleId);
  if (!rule) throw new Error(`unknown rule: ${ruleId}`);
  const ctx = await contextFor(source, language, deps);
  return rule.run(ctx);
}

/** Same as `runRule`, but lets the test control the repository-relative path. */
export async function runRuleOnFile(
  ruleId: string,
  source: string,
  language: LanguageId,
  file: string,
  deps: ProjectDeps = makeDeps(),
): Promise<RuleDraft[]> {
  const rule = RULE_BY_ID.get(ruleId);
  if (!rule) throw new Error(`unknown rule: ${ruleId}`);
  const ctx = await contextFor(source, language, deps, file);
  return rule.run(ctx);
}

export async function scanFixture(
  name: string,
  configPatch: Partial<Config> = {},
  onlyRules?: readonly string[],
): Promise<ScanResult> {
  const root = path.join(FIXTURES, name);
  return scanProject({
    root,
    config: { ...DEFAULT_CONFIG, rules: {}, ...configPatch },
    ...(onlyRules ? { onlyRules: new Set(onlyRules) } : {}),
  });
}
