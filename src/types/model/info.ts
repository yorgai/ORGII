/**
 * Model Info Registry
 *
 * Static descriptive metadata about common LLMs (Anthropic Claude, OpenAI
 * GPT/o-series, Google Gemini, DeepSeek, Meta Llama, xAI Grok, Mistral, Qwen,
 * GitHub Copilot, Cursor's own composer).
 *
 * Used by `<ContextInfoButton />` to read each model's `contextWindow` for
 * the chat-input token-budget gauge. The richer fields (`provider`,
 * `providerKey`, `vision`, `reasoning`, `strengthKeys`, `pricingTier`) are
 * preserved so that future UI surfaces (model cards, pickers) can pick them
 * up without another data migration.
 *
 * NOTE: there are two unrelated `ModelInfo` types in this codebase —
 *   1. `import type { ModelInfo } from "@src/types/model/info";`  ← this file
 *      Static frontend descriptor (provider brand, context window, etc.)
 *   2. `import type { ModelInfo } from "@src/api/http/config";`
 *      Embedding-model wire row used by the indexing settings page.
 * They are NOT interchangeable. Consumers must pick the right one by
 * import path.
 */

export type PricingTier =
  | "free"
  | "budget"
  | "moderate"
  | "expensive"
  | "premium";

export interface ModelInfo {
  /** Provider company name (not translated — brand name) */
  provider: string;
  /** i18n key suffix for provider description */
  providerKey: string;
  /** Context window in thousands of tokens (e.g. 200 = 200K) */
  contextWindow: number;
  /** Max output tokens in thousands (optional) */
  maxOutput?: number;
  /** Whether the model supports vision/image input */
  vision: boolean;
  /** Whether the model supports extended thinking / chain-of-thought */
  reasoning?: boolean;
  /** i18n key suffixes for model strengths (under market.modelInfo.strengths.*) */
  strengthKeys: string[];
  /** Approximate pricing tier */
  pricingTier: PricingTier;
}

/**
 * Patterns are matched against model category strings from the API.
 * More specific patterns come before generic ones; the first
 * `lower.includes(pattern)` hit wins.
 */
const MODEL_INFO_ENTRIES: Array<{ pattern: string; info: ModelInfo }> = [
  // ─── Anthropic (Claude) ───────────────────────────────────
  {
    pattern: "claude-opus-4",
    info: {
      provider: "Anthropic",
      providerKey: "anthropic",
      contextWindow: 1000,
      maxOutput: 32,
      vision: true,
      reasoning: true,
      strengthKeys: ["coding", "agentic", "reasoning", "planning"],
      pricingTier: "expensive",
    },
  },
  {
    pattern: "claude-sonnet-4.5",
    info: {
      provider: "Anthropic",
      providerKey: "anthropic",
      contextWindow: 200,
      maxOutput: 16,
      vision: true,
      reasoning: true,
      strengthKeys: ["coding", "balanced", "agentic", "speed"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "claude-sonnet-4-5",
    info: {
      provider: "Anthropic",
      providerKey: "anthropic",
      contextWindow: 200,
      maxOutput: 16,
      vision: true,
      reasoning: true,
      strengthKeys: ["coding", "balanced", "agentic", "speed"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "claude-sonnet-4.6",
    info: {
      provider: "Anthropic",
      providerKey: "anthropic",
      contextWindow: 1000,
      maxOutput: 16,
      vision: true,
      reasoning: true,
      strengthKeys: ["coding", "balanced", "agentic", "speed"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "claude-sonnet-4-6",
    info: {
      provider: "Anthropic",
      providerKey: "anthropic",
      contextWindow: 1000,
      maxOutput: 16,
      vision: true,
      reasoning: true,
      strengthKeys: ["coding", "balanced", "agentic", "speed"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "claude-sonnet-4",
    info: {
      provider: "Anthropic",
      providerKey: "anthropic",
      contextWindow: 200,
      maxOutput: 16,
      vision: true,
      reasoning: true,
      strengthKeys: ["coding", "balanced", "agentic", "speed"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "claude-4-5-haiku",
    info: {
      provider: "Anthropic",
      providerKey: "anthropic",
      contextWindow: 200,
      maxOutput: 8,
      vision: true,
      strengthKeys: ["speed", "costEffective", "highVolume"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "claude-3.5-sonnet",
    info: {
      provider: "Anthropic",
      providerKey: "anthropic",
      contextWindow: 200,
      maxOutput: 8,
      vision: true,
      strengthKeys: ["coding", "balanced", "reliable"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "claude-3-5-sonnet",
    info: {
      provider: "Anthropic",
      providerKey: "anthropic",
      contextWindow: 200,
      maxOutput: 8,
      vision: true,
      strengthKeys: ["coding", "balanced", "reliable"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "claude-3.5-haiku",
    info: {
      provider: "Anthropic",
      providerKey: "anthropic",
      contextWindow: 200,
      maxOutput: 8,
      vision: true,
      strengthKeys: ["speed", "costEffective"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "claude-3-5-haiku",
    info: {
      provider: "Anthropic",
      providerKey: "anthropic",
      contextWindow: 200,
      maxOutput: 8,
      vision: true,
      strengthKeys: ["speed", "costEffective"],
      pricingTier: "budget",
    },
  },
  // claude-fable-5 / claude-mythos: 1M context window (Anthropic).
  {
    pattern: "claude-fable",
    info: {
      provider: "Anthropic",
      providerKey: "anthropic",
      contextWindow: 1000,
      maxOutput: 32,
      vision: true,
      reasoning: true,
      strengthKeys: ["coding", "agentic", "reasoning", "planning"],
      pricingTier: "expensive",
    },
  },
  {
    pattern: "claude-mythos",
    info: {
      provider: "Anthropic",
      providerKey: "anthropic",
      contextWindow: 1000,
      maxOutput: 32,
      vision: true,
      reasoning: true,
      strengthKeys: ["coding", "agentic", "reasoning", "planning"],
      pricingTier: "expensive",
    },
  },
  // Generic Claude fallback — all current/new Anthropic models ship with a
  // 1M window, so the catch-all matches the backend FAMILY_RULES default.
  {
    pattern: "claude",
    info: {
      provider: "Anthropic",
      providerKey: "anthropic",
      contextWindow: 1000,
      vision: true,
      strengthKeys: ["coding", "reasoning"],
      pricingTier: "moderate",
    },
  },

  // ─── OpenAI (GPT & o-series) ──────────────────────────────
  {
    pattern: "gpt-4.1",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 1000,
      maxOutput: 32,
      vision: true,
      strengthKeys: ["longContext", "instructionFollowing", "coding"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "gpt-4o-mini",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 128,
      maxOutput: 16,
      vision: true,
      strengthKeys: ["speed", "costEffective", "multimodal"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "gpt-4o",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 128,
      maxOutput: 16,
      vision: true,
      strengthKeys: ["multimodal", "balanced", "realtime"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "gpt-4.1-mini",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 1000,
      maxOutput: 32,
      vision: true,
      strengthKeys: ["longContext", "costEffective"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "gpt-4.1-nano",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 1000,
      maxOutput: 32,
      vision: false,
      strengthKeys: ["longContext", "speed", "costEffective"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "o3-mini",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 200,
      maxOutput: 100,
      vision: false,
      reasoning: true,
      strengthKeys: ["reasoning", "math", "costEffective"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "o4-mini",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 200,
      maxOutput: 100,
      vision: false,
      reasoning: true,
      strengthKeys: ["reasoning", "stem", "costEffective"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "o3",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 200,
      maxOutput: 100,
      vision: false,
      reasoning: true,
      strengthKeys: ["reasoning", "math", "coding"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "o1",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 200,
      maxOutput: 100,
      vision: false,
      reasoning: true,
      strengthKeys: ["reasoning", "knowledge"],
      pricingTier: "expensive",
    },
  },
  // Generic GPT fallback
  {
    pattern: "gpt",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 128,
      vision: true,
      strengthKeys: ["multimodal", "balanced"],
      pricingTier: "moderate",
    },
  },

  // ─── Cursor ───────────────────────────────────────────────
  {
    pattern: "cursor-small",
    info: {
      provider: "Cursor",
      providerKey: "cursor",
      contextWindow: 128,
      vision: false,
      strengthKeys: ["speed", "costEffective", "autocomplete"],
      pricingTier: "free",
    },
  },
  {
    pattern: "composer",
    info: {
      provider: "Cursor",
      providerKey: "cursor",
      contextWindow: 128,
      vision: false,
      strengthKeys: ["coding", "agentic"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "auto",
    info: {
      provider: "Cursor",
      providerKey: "cursor",
      contextWindow: 128,
      vision: false,
      strengthKeys: ["autoSelect", "balanced"],
      pricingTier: "moderate",
    },
  },

  // ─── Google (Gemini) ──────────────────────────────────────
  {
    pattern: "gemini-2.5-pro",
    info: {
      provider: "Google",
      providerKey: "google",
      contextWindow: 1000,
      maxOutput: 64,
      vision: true,
      reasoning: true,
      strengthKeys: ["coding", "longContext", "multimodal"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "gemini-2.5-flash",
    info: {
      provider: "Google",
      providerKey: "google",
      contextWindow: 1000,
      maxOutput: 64,
      vision: true,
      reasoning: true,
      strengthKeys: ["speed", "costEffective", "multimodal"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "gemini-2.0-flash",
    info: {
      provider: "Google",
      providerKey: "google",
      contextWindow: 1000,
      maxOutput: 8,
      vision: true,
      strengthKeys: ["speed", "costEffective", "multimodal"],
      pricingTier: "budget",
    },
  },
  // Generic Gemini fallback
  {
    pattern: "gemini",
    info: {
      provider: "Google",
      providerKey: "google",
      contextWindow: 1000,
      vision: true,
      strengthKeys: ["multimodal", "longContext"],
      pricingTier: "moderate",
    },
  },

  // ─── DeepSeek ─────────────────────────────────────────────
  {
    pattern: "deepseek-r1",
    info: {
      provider: "DeepSeek",
      providerKey: "deepseek",
      contextWindow: 128,
      maxOutput: 64,
      vision: false,
      reasoning: true,
      strengthKeys: ["reasoning", "math", "costEffective"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "deepseek-v3",
    info: {
      provider: "DeepSeek",
      providerKey: "deepseek",
      contextWindow: 128,
      maxOutput: 8,
      vision: false,
      strengthKeys: ["coding", "costEffective", "highVolume"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "deepseek-chat",
    info: {
      provider: "DeepSeek",
      providerKey: "deepseek",
      contextWindow: 128,
      maxOutput: 8,
      vision: false,
      strengthKeys: ["coding", "costEffective", "highVolume"],
      pricingTier: "budget",
    },
  },
  // Generic DeepSeek fallback
  {
    pattern: "deepseek",
    info: {
      provider: "DeepSeek",
      providerKey: "deepseek",
      contextWindow: 128,
      vision: false,
      strengthKeys: ["costEffective", "coding"],
      pricingTier: "budget",
    },
  },

  // ─── Meta (Llama) ─────────────────────────────────────────
  {
    pattern: "llama-4",
    info: {
      provider: "Meta",
      providerKey: "meta",
      contextWindow: 128,
      vision: true,
      strengthKeys: ["openWeight", "multimodal", "costEffective"],
      pricingTier: "free",
    },
  },
  {
    pattern: "llama-3",
    info: {
      provider: "Meta",
      providerKey: "meta",
      contextWindow: 128,
      vision: false,
      strengthKeys: ["openWeight", "balanced", "costEffective"],
      pricingTier: "free",
    },
  },
  // Generic Llama fallback
  {
    pattern: "llama",
    info: {
      provider: "Meta",
      providerKey: "meta",
      contextWindow: 128,
      vision: false,
      strengthKeys: ["openWeight", "costEffective"],
      pricingTier: "free",
    },
  },

  // ─── xAI (Grok) ──────────────────────────────────────────
  {
    pattern: "grok",
    info: {
      provider: "xAI",
      providerKey: "xai",
      contextWindow: 128,
      vision: true,
      strengthKeys: ["coding", "balanced"],
      pricingTier: "moderate",
    },
  },

  // ─── Mistral ──────────────────────────────────────────────
  {
    pattern: "mistral",
    info: {
      provider: "Mistral AI",
      providerKey: "mistral",
      contextWindow: 128,
      vision: false,
      strengthKeys: ["coding", "costEffective", "speed"],
      pricingTier: "budget",
    },
  },

  // ─── Qwen (Alibaba) ──────────────────────────────────────
  {
    pattern: "qwen",
    info: {
      provider: "Alibaba",
      providerKey: "alibaba",
      contextWindow: 128,
      vision: true,
      strengthKeys: ["multilingual", "costEffective"],
      pricingTier: "budget",
    },
  },

  // ─── GitHub Copilot ───────────────────────────────────────
  {
    pattern: "copilot",
    info: {
      provider: "GitHub",
      providerKey: "github",
      contextWindow: 128,
      vision: false,
      strengthKeys: ["coding", "autocomplete"],
      pricingTier: "moderate",
    },
  },
];

/**
 * Look up model info by category string from the API.
 * Uses prefix/substring matching against registered patterns.
 * Returns the first (most specific) match, or null if no match.
 */
export function getModelInfo(category: string): ModelInfo | null {
  const lower = category.toLowerCase();
  for (const entry of MODEL_INFO_ENTRIES) {
    if (lower.includes(entry.pattern)) {
      return entry.info;
    }
  }
  return null;
}
