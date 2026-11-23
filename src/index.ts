/**
 * Public programmatic API. The CLI is built on the same exports.
 *
 * This surface is the stable contract starting at 1.0.0. Rule ids, config
 * keys, finding/JSON fields, SARIF fields, MCP method names and exit codes are
 * documented in docs/contract.md.
 */
export { scanProject } from './engine.ts';
export type { ScanOptions, ScanResult } from './engine.ts';
export { applyFixes } from './fix.ts';
export type { FixApplyResult } from './fix.ts';
export {
  DEFAULT_CONFIG,
  loadConfig,
  normalizeConfig,
  type Config,
} from './config.ts';
export { ALL_RULE_METAS, ALL_RULE_BY_ID, PROJECT_RULES } from './rules/index.ts';
export type {
  Confidence,
  Finding,
  LanguageId,
  ProjectFindingDraft,
  ProjectRule,
  Rule,
  RuleDraft,
  RuleMeta,
  ScanFix,
  ScanStats,
  Severity,
  SourceDialect,
} from './types.ts';

/** Bumped only for a breaking public-contract change. */
export const CONTRACT_VERSION = 1;
