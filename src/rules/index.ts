import type { Rule } from '../types.ts';
import { pythonRules } from './python.ts';
import { typescriptRules } from './typescript.ts';

export const ALL_RULES: readonly Rule[] = [...pythonRules, ...typescriptRules];

export const RULE_BY_ID: ReadonlyMap<string, Rule> = new Map(ALL_RULES.map((rule) => [rule.meta.id, rule]));
