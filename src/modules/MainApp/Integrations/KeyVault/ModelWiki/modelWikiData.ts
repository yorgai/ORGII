/**
 * Model Wiki data — static reference catalog of public LLM metadata.
 *
 * The catalog is fetched once from the OpenRouter Models API
 * (`https://openrouter.ai/api/v1/models`) and stored in
 * `modelWikiCatalog.json`. OpenRouter is the only public API that exposes
 * per-model context window, max output tokens, and supported parameters for
 * every major provider in a single unauthenticated request — the official
 * OpenAI / Anthropic `/v1/models` endpoints return model IDs only.
 *
 * To refresh the snapshot, re-run the fetch and regenerate the JSON file.
 */
import rawCatalog from "./modelWikiCatalog.json";

/** One row in the model wiki — trimmed from the OpenRouter Model object. */
export interface ModelWikiEntry {
  /** OpenRouter model identifier, e.g. `anthropic/claude-sonnet-4.6`. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Maximum context window size in tokens. */
  contextLength: number;
  /** Maximum response length in tokens. Null when the provider omits it. */
  maxTokens: number | null;
  /** Model supports function/tool calling (`tools` parameter). */
  supportsTools: boolean;
  /** Model supports an internal reasoning mode (`reasoning` parameter). */
  supportsReasoning: boolean;
  /** Reasoning trace can be returned in the response (`include_reasoning`). */
  supportsIncludeReasoning: boolean;
  /** Unix timestamp (seconds) of when the model was added to the catalog. */
  created: number;
}

interface ModelWikiCatalog {
  source: string;
  fetchedAt: string;
  modelCount: number;
  models: ModelWikiEntry[];
}

const catalog = rawCatalog as ModelWikiCatalog;

/** All catalog entries, pre-sorted newest-first by `created`. */
export const MODEL_WIKI_ENTRIES: readonly ModelWikiEntry[] = catalog.models;

/** Endpoint the snapshot was sourced from. */
export const MODEL_WIKI_SOURCE = catalog.source;

/** ISO timestamp of when the snapshot was captured. */
export const MODEL_WIKI_FETCHED_AT = catalog.fetchedAt;

/** Total number of models in the snapshot. */
export const MODEL_WIKI_MODEL_COUNT = catalog.modelCount;

/** Format a token count as a compact string (e.g. `1M`, `200K`). */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = Number(
      (tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)
    );
    return `${millions}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return String(tokens);
}
