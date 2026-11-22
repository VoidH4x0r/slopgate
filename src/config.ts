import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { DEFAULT_INCLUDE } from './files.ts';
import type { Confidence, Severity } from './types.ts';

export type FailOn = 'high' | 'medium' | 'low' | 'none';

export interface Config {
  include: string[];
  exclude: string[];
  /** Top-level module names to always treat as declared. */
  ignoreModules: string[];
  /** Rule id -> 'off' or an explicit severity. */
  rules: Record<string, 'off' | Severity>;
  /** Minimum confidence to display. */
  confidence: Confidence;
  /** Minimum confidence that makes the process exit non-zero. */
  failOn: FailOn;
}

export interface LoadedConfig {
  config: Config;
  file: string | undefined;
}

export const CONFIG_FILENAMES = ['.slopgate.json', 'slopgate.config.json'] as const;

export const DEFAULT_CONFIG: Config = {
  include: [...DEFAULT_INCLUDE],
  exclude: [],
  ignoreModules: [],
  rules: {},
  confidence: 'high',
  failOn: 'high',
};

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];
const FAIL_ON: readonly FailOn[] = ['high', 'medium', 'low', 'none'];

export function confidenceRank(c: Confidence): number {
  return CONFIDENCE_RANK[c];
}

export function meetsConfidence(value: Confidence, minimum: Confidence): boolean {
  return CONFIDENCE_RANK[value] >= CONFIDENCE_RANK[minimum];
}

function asStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`config field "${field}" must be an array of strings`);
  }
  return value as string[];
}

/** Merge a user-supplied config object over the defaults, validating as we go. */
export function normalizeConfig(raw: unknown): Config {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('config must be a JSON object');
  }
  const input = raw as Record<string, unknown>;
  const config: Config = { ...DEFAULT_CONFIG, rules: {} };

  config.include = asStringArray(input.include, 'include') ?? config.include;
  config.exclude = asStringArray(input.exclude, 'exclude') ?? config.exclude;
  config.ignoreModules = asStringArray(input.ignoreModules, 'ignoreModules') ?? config.ignoreModules;

  if (input.rules !== undefined) {
    if (input.rules === null || typeof input.rules !== 'object' || Array.isArray(input.rules)) {
      throw new Error('config field "rules" must be an object');
    }
    for (const [ruleId, value] of Object.entries(input.rules as Record<string, unknown>)) {
      if (value === 'off') {
        config.rules[ruleId] = 'off';
      } else if (typeof value === 'string' && SEVERITIES.includes(value as Severity)) {
        config.rules[ruleId] = value as Severity;
      } else {
        throw new Error(`rule "${ruleId}" must be "off", "error", "warning" or "info"`);
      }
    }
  }

  if (input.confidence !== undefined) {
    if (
      typeof input.confidence !== 'string' ||
      !Object.hasOwn(CONFIDENCE_RANK, input.confidence)
    ) {
      throw new Error('config field "confidence" must be "high", "medium" or "low"');
    }
    config.confidence = input.confidence as Confidence;
  }

  if (input.failOn !== undefined) {
    if (typeof input.failOn !== 'string' || !FAIL_ON.includes(input.failOn as FailOn)) {
      throw new Error('config field "failOn" must be one of high|medium|low|none');
    }
    config.failOn = input.failOn as FailOn;
  }

  return config;
}

export async function loadConfig(root: string): Promise<LoadedConfig> {
  for (const name of CONFIG_FILENAMES) {
    const file = path.join(root, name);
    try {
      const raw = await readFile(file, 'utf8');
      // Editors on Windows like to write a UTF-8 BOM; JSON.parse rejects it.
      const text = raw.replace(/^\uFEFF/, '');
      const parsed: unknown = JSON.parse(text);
      return { config: normalizeConfig(parsed), file: name };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      if (error instanceof SyntaxError) {
        throw new Error(`${name} is not valid JSON (${error.message})`);
      }
      throw error;
    }
  }
  return { config: { ...DEFAULT_CONFIG, rules: {} }, file: undefined };
}
