import * as vscode from 'vscode';

/**
 * Fetches model pricing/multiplier data from GitHub's API at runtime.
 * Falls back to hardcoded defaults if the fetch fails.
 */

export interface CatalogModel {
  id: string;
  name: string;
  multiplier: number;
}

// Cached multiplier map: model-id → multiplier
let cachedMultipliers: Map<string, number> | undefined;
let lastFetchTime = 0;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Get a GitHub auth token from VS Code's authentication provider.
 */
async function getGitHubToken(): Promise<string | undefined> {
  const scopesToTry = [['read:user'], ['user:email'], []];
  for (const scopes of scopesToTry) {
    try {
      const session = await vscode.authentication.getSession('github', scopes, { createIfNone: false });
      if (session) return session.accessToken;
    } catch { /* continue */ }
  }
  return undefined;
}

/**
 * Fetch model catalog from GitHub's Copilot models endpoint.
 * Tries multiple known endpoints for model/pricing data.
 */
async function fetchModelsFromGitHub(token: string): Promise<Map<string, number> | undefined> {
  const endpoints = [
    'https://api.github.com/copilot/models',
    'https://models.github.ai/catalog/models',
  ];

  for (const url of endpoints) {
    try {
      const resp = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!resp.ok) continue;

      const data = await resp.json() as any[];
      if (!Array.isArray(data) || data.length === 0) continue;

      const map = new Map<string, number>();
      for (const model of data) {
        // The field name varies by endpoint — try known fields
        const id: string = (model.id || model.slug || model.name || '').toLowerCase().replace(/[\s_]+/g, '-');
        const mult: number | undefined =
          model.multiplier ??
          model.pricing_multiplier ??
          model.cost_multiplier ??
          model.pricing?.multiplier ??
          model.premium_request_multiplier;

        if (id && mult !== undefined) {
          // Normalize: strip publisher prefix (e.g. "openai/gpt-4.1" → "gpt-4.1")
          const shortId = id.includes('/') ? id.split('/').pop()! : id;
          map.set(shortId, mult);
        }
      }

      if (map.size > 0) return map;
    } catch { /* try next endpoint */ }
  }
  return undefined;
}

/**
 * Refresh the multiplier cache from GitHub.
 * Safe to call frequently — respects cache TTL.
 */
export async function refreshModelCatalog(): Promise<void> {
  const now = Date.now();
  if (cachedMultipliers && (now - lastFetchTime) < CACHE_TTL_MS) return;

  const token = await getGitHubToken();
  if (!token) return;

  const result = await fetchModelsFromGitHub(token);
  if (result && result.size > 0) {
    cachedMultipliers = result;
    lastFetchTime = now;
  }
}

/**
 * Get the cached multiplier for a model, or undefined if not fetched.
 */
export function getCatalogMultiplier(normalizedModel: string): number | undefined {
  if (!cachedMultipliers) return undefined;

  // Exact match
  if (cachedMultipliers.has(normalizedModel)) {
    return cachedMultipliers.get(normalizedModel);
  }

  // Partial prefix match
  for (const [key, mult] of cachedMultipliers) {
    if (normalizedModel.startsWith(key) || key.startsWith(normalizedModel)) {
      return mult;
    }
  }

  return undefined;
}
