/**
 * GitHub Copilot model pricing (effective June 1, 2026).
 * Prices are per 1 million tokens in USD.
 * AI Credits conversion: 1 AI Credit = $0.01 USD.
 *
 * Code completions and next edit suggestions are NOT billed.
 * Only Chat, CLI, cloud agent, Spaces, Spark, and third-party coding agents consume AI credits.
 */

import { getCatalogMultiplier } from './model-catalog';

export interface ModelPricing {
  inputPerMillion: number;
  cachedPerMillion: number;
  outputPerMillion: number;
  /** GitHub-defined premium request multiplier (0x = included free, 1x = standard) */
  multiplier: number;
}

/**
 * Per-model pricing in USD per 1M tokens.
 * Source: https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI — multipliers from GitHub Language Models picker
  'gpt-4.1': { inputPerMillion: 2.00, cachedPerMillion: 0.50, outputPerMillion: 8.00, multiplier: 0 },
  'gpt-4o': { inputPerMillion: 2.00, cachedPerMillion: 0.50, outputPerMillion: 8.00, multiplier: 0 },
  'gpt-5-mini': { inputPerMillion: 0.25, cachedPerMillion: 0.025, outputPerMillion: 2.00, multiplier: 0 },
  'gpt-5.2': { inputPerMillion: 1.75, cachedPerMillion: 0.175, outputPerMillion: 14.00, multiplier: 1 },
  'gpt-5.2-codex': { inputPerMillion: 1.75, cachedPerMillion: 0.175, outputPerMillion: 14.00, multiplier: 1 },
  'gpt-5.3-codex': { inputPerMillion: 1.75, cachedPerMillion: 0.175, outputPerMillion: 14.00, multiplier: 1 },
  'gpt-5.4': { inputPerMillion: 2.50, cachedPerMillion: 0.25, outputPerMillion: 15.00, multiplier: 1 },
  'gpt-5.4-mini': { inputPerMillion: 0.75, cachedPerMillion: 0.075, outputPerMillion: 4.50, multiplier: 0.33 },
  'gpt-5.4-nano': { inputPerMillion: 0.20, cachedPerMillion: 0.02, outputPerMillion: 1.25, multiplier: 0 },
  'gpt-5.5': { inputPerMillion: 5.00, cachedPerMillion: 0.50, outputPerMillion: 30.00, multiplier: 7.5 },

  // Anthropic
  'claude-haiku-4.5': { inputPerMillion: 1.00, cachedPerMillion: 0.10, outputPerMillion: 5.00, multiplier: 0.33 },
  'claude-sonnet-4': { inputPerMillion: 3.00, cachedPerMillion: 0.30, outputPerMillion: 15.00, multiplier: 1 },
  'claude-sonnet-4.5': { inputPerMillion: 3.00, cachedPerMillion: 0.30, outputPerMillion: 15.00, multiplier: 1 },
  'claude-sonnet-4.6': { inputPerMillion: 3.00, cachedPerMillion: 0.30, outputPerMillion: 15.00, multiplier: 1 },
  'claude-opus-4.5': { inputPerMillion: 5.00, cachedPerMillion: 0.50, outputPerMillion: 25.00, multiplier: 3 },
  'claude-opus-4.6': { inputPerMillion: 5.00, cachedPerMillion: 0.50, outputPerMillion: 25.00, multiplier: 3 },
  'claude-opus-4.7': { inputPerMillion: 5.00, cachedPerMillion: 0.50, outputPerMillion: 25.00, multiplier: 15 },

  // Google
  'gemini-2.5-pro': { inputPerMillion: 1.25, cachedPerMillion: 0.125, outputPerMillion: 10.00, multiplier: 1 },
  'gemini-3-flash': { inputPerMillion: 0.50, cachedPerMillion: 0.05, outputPerMillion: 3.00, multiplier: 0.33 },
  'gemini-3.1-pro': { inputPerMillion: 2.00, cachedPerMillion: 0.20, outputPerMillion: 12.00, multiplier: 1 },
  'gemini-3.5-flash': { inputPerMillion: 1.50, cachedPerMillion: 0.15, outputPerMillion: 9.00, multiplier: 1 },

  // GitHub fine-tuned
  'raptor-mini': { inputPerMillion: 0.25, cachedPerMillion: 0.025, outputPerMillion: 2.00, multiplier: 0 },
  'goldeneye': { inputPerMillion: 1.25, cachedPerMillion: 0.125, outputPerMillion: 10.00, multiplier: 1 },
};

// Default pricing for unknown models (uses GPT-5 mini rates as conservative estimate)
const DEFAULT_PRICING: ModelPricing = { inputPerMillion: 0.25, cachedPerMillion: 0.025, outputPerMillion: 2.00, multiplier: 1 };

/**
 * Normalize model name for pricing lookup.
 * Copilot telemetry may report models with varying casing and separators.
 */
function normalizeModelName(model: string): string {
  return model.toLowerCase().replace(/[\s_]+/g, '-');
}

/**
 * Get pricing for a model. Falls back to default if unknown.
 */
export function getModelPricing(model: string): ModelPricing {
  const normalized = normalizeModelName(model);

  // Exact match
  if (MODEL_PRICING[normalized]) return MODEL_PRICING[normalized];

  // Partial match (e.g. "gpt-4.1-2025-04-14" → "gpt-4.1")
  for (const key of Object.keys(MODEL_PRICING)) {
    if (normalized.startsWith(key)) return MODEL_PRICING[key];
  }

  return DEFAULT_PRICING;
}

/**
 * Get the GitHub-defined premium request multiplier for a model.
 * Checks live catalog data first, falls back to hardcoded values.
 * 0x = included free, 1x = standard premium, 3x/7.5x/15x = higher premium.
 */
export function getModelMultiplier(model: string): number {
  const normalized = normalizeModelName(model);

  // Prefer live data from GitHub API
  const live = getCatalogMultiplier(normalized);
  if (live !== undefined) return live;

  // Fall back to hardcoded
  const pricing = getModelPricing(model);
  return pricing.multiplier;
}

/**
 * Calculate AI credits consumed by a request.
 * Returns 0 for non-billable requests (inline completions).
 *
 * Formula: (inputTokens × inputRate + cachedTokens × cachedRate + outputTokens × outputRate) / 1M
 * Then convert USD → AI Credits: USD / 0.01
 */
export function calculateAiCredits(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  billable: boolean
): number {
  if (!billable) return 0;

  const pricing = getModelPricing(model);
  const costUsd =
    (inputTokens * pricing.inputPerMillion +
      cachedTokens * pricing.cachedPerMillion +
      outputTokens * pricing.outputPerMillion) / 1_000_000;

  // 1 AI credit = $0.01
  return costUsd / 0.01;
}
