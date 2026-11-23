import type { ProjectRule, Rule, RuleMeta } from '../types.ts';
import { duplicateRules } from './duplicates.ts';
import { goRules } from './go.ts';
import { pythonRules } from './python.ts';
import { rustRules } from './rust.ts';
import { typescriptRules } from './typescript.ts';

/** Per-file rules. */
export const FILE_RULES: readonly Rule[] = [...pythonRules, ...typescriptRules, ...goRules, ...rustRules];

/** Rules that need the whole scan before they can report. */
export const PROJECT_RULES: readonly ProjectRule[] = duplicateRules;

/** Everything the CLI/config must know about, including project rules. */
export const ALL_RULE_METAS: readonly RuleMeta[] = [
  ...FILE_RULES.map((rule) => rule.meta),
  ...PROJECT_RULES.map((rule) => rule.meta),
];

/** Backwards-compatible alias for the per-file rule list. */
export const ALL_RULES = FILE_RULES;

export const RULE_BY_ID: ReadonlyMap<string, Rule> = new Map(
  FILE_RULES.map((rule) => [rule.meta.id, rule]),
);

export const PROJECT_RULE_BY_ID: ReadonlyMap<string, ProjectRule> = new Map(
  PROJECT_RULES.map((rule) => [rule.meta.id, rule]),
);

export const ALL_RULE_BY_ID: ReadonlyMap<string, Rule | ProjectRule> = (() => {
  const map = new Map<string, Rule | ProjectRule>();
  for (const [id, rule] of RULE_BY_ID) map.set(id, rule);
  for (const [id, rule] of PROJECT_RULE_BY_ID) map.set(id, rule);
  return map;
})();
