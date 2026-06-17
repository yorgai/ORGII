/**
 * ModelIcon Configuration
 *
 * Unified icon system for all AI model providers and agents.
 *
 * This is the single source of truth for icon lookups. It supports:
 * - `ModelType` (business logic) → icon lookup via `getIconProvider()`
 * - `IconProvider` (UI layer) → direct icon lookup
 * - Model name string → icon inference via `getIconProviderFromModelName()`
 */
import type { FC, SVGProps } from "react";

import type { ModelType } from "@src/api/types/keys";
// ============================================
// SVG Icon Imports (from agentIcons - React components with unique gradient IDs)
// ============================================
import {
  AWSIcon,
  AiderIcon,
  ClaudeCodeIcon,
  ClaudeIcon,
  ClineIcon,
  CodexIcon,
  CopilotIcon,
  CursorIcon,
  GeminiIcon,
  GooseIcon,
  KimiIcon,
  KiroIcon,
  OpenAIIcon,
  OpenCodeIcon,
  OrgiiIcon,
} from "@src/assets/modelIcons/agentIcons";
// Static SVG imports (for providers without React components)
import AzureIcon from "@src/assets/modelIcons/azure.svg";
import BaichuanIcon from "@src/assets/modelIcons/baichuan.svg";
import ByteDanceIcon from "@src/assets/modelIcons/bytedance.svg";
import DeepSeekIcon from "@src/assets/modelIcons/deepseek.svg";
import DoubaoIcon from "@src/assets/modelIcons/doubao.svg";
import GrokIcon from "@src/assets/modelIcons/grok.svg";
import GroqIcon from "@src/assets/modelIcons/groq.svg";
import MetaIcon from "@src/assets/modelIcons/meta.svg";
import MinimaxIcon from "@src/assets/modelIcons/minimax.svg";
import MistralIcon from "@src/assets/modelIcons/mistral.svg";
import OpenRouterIcon from "@src/assets/modelIcons/openrouter.svg";
import PerplexityIcon from "@src/assets/modelIcons/perplexity.svg";
import QwenIcon from "@src/assets/modelIcons/qwen.svg";
import VllmIcon from "@src/assets/modelIcons/vllm.svg";
import VolcengineIcon from "@src/assets/modelIcons/volcengine.svg";
import YiIcon from "@src/assets/modelIcons/yi.svg";
import ZenMuxIcon from "@src/assets/modelIcons/zenmux.svg";
import ZhipuIcon from "@src/assets/modelIcons/zhipu.svg";

// ============================================
// Types
// ============================================

/**
 * Icon provider — short brand name for icon lookup.
 *
 * This is a UI/display layer type that maps from business types
 * (`ModelType`, model names) to brand icons.
 */
export type IconProvider =
  | "openai"
  | "codex"
  | "aws"
  | "azure"
  | "claude"
  | "claude_code"
  | "copilot"
  | "cursor"
  | "gemini"
  | "grok"
  | "groq"
  | "deepseek"
  | "mistral"
  | "qwen"
  | "meta"
  | "perplexity"
  | "kiro"
  | "kimi"
  | "bytedance"
  | "volcengine"
  | "yi"
  | "zhipu"
  | "baichuan"
  | "minimax"
  | "doubao"
  | "openrouter"
  | "zenmux"
  | "vllm"
  | "orgii"
  // Inactive agents (kept for future use)
  | "aider"
  | "cline"
  | "goose"
  | "opencode"
  | "unknown";

// ============================================
// Icon Map
// ============================================

/** Maps icon providers to their corresponding SVG icon components */
export const ICON_MAP: Record<
  IconProvider,
  FC<SVGProps<SVGSVGElement>> | undefined
> = {
  // CLI agents (active)
  cursor: CursorIcon,
  claude_code: ClaudeCodeIcon,
  copilot: CopilotIcon,
  gemini: GeminiIcon,
  kiro: KiroIcon,
  // OpenAI-related
  openai: OpenAIIcon,
  codex: CodexIcon, // Codex uses OpenAI branding but has its own icon
  // Anthropic
  claude: ClaudeIcon,
  // ORGII
  orgii: OrgiiIcon,
  // API providers
  aws: AWSIcon,
  azure: AzureIcon,
  deepseek: DeepSeekIcon,
  grok: GrokIcon,
  groq: GroqIcon,
  mistral: MistralIcon,
  qwen: QwenIcon,
  meta: MetaIcon,
  perplexity: PerplexityIcon,
  kimi: KimiIcon,
  bytedance: ByteDanceIcon,
  volcengine: VolcengineIcon,
  yi: YiIcon,
  zhipu: ZhipuIcon,
  baichuan: BaichuanIcon,
  minimax: MinimaxIcon,
  doubao: DoubaoIcon,
  openrouter: OpenRouterIcon,
  zenmux: ZenMuxIcon,
  vllm: VllmIcon,
  // Active agent
  opencode: OpenCodeIcon,
  // Inactive agents (kept for future use)
  aider: AiderIcon,
  cline: ClineIcon,
  goose: GooseIcon,
  // Fallback
  unknown: undefined,
};

/** Active icon providers available for user selection (excludes unknown + inactive agents) */
export const SELECTABLE_ICON_PROVIDERS: IconProvider[] = [
  "openai",
  "claude",
  "claude_code",
  "gemini",
  "deepseek",
  "cursor",
  "copilot",
  "kiro",
  "codex",
  "grok",
  "groq",
  "mistral",
  "qwen",
  "meta",
  "perplexity",
  "kimi",
  "aws",
  "azure",
  "bytedance",
  "volcengine",
  "yi",
  "zhipu",
  "baichuan",
  "minimax",
  "doubao",
  "openrouter",
  "zenmux",
  "vllm",
  "orgii",
  "opencode",
];

/**
 * ORGII orchestrator + CLI coding-agent brands — excluded from custom model icon
 * picker (only API / model-hosting providers).
 */
const EXCLUDED_MODEL_ALIAS_ICON_PROVIDER: ReadonlySet<IconProvider> = new Set([
  "orgii",
  "cursor",
  "claude_code",
  "copilot",
  "kiro",
  "codex",
  "opencode",
]);

/** Model/API provider icons for KeyVault custom model table (no ORGII, no CLI agents). */
export const MODEL_PROVIDER_ICON_PROVIDERS: IconProvider[] =
  SELECTABLE_ICON_PROVIDERS.filter(
    (provider) => !EXCLUDED_MODEL_ALIAS_ICON_PROVIDER.has(provider)
  );

// ============================================
// ModelType → IconProvider Mapping
// ============================================

/**
 * Maps ModelType (business logic) to IconProvider (UI display).
 *
 * This is the single source of truth for converting business types to icon brands.
 */
const MODEL_TYPE_TO_ICON: Record<ModelType, IconProvider> = {
  // CLI agents (active)
  cursor_cli: "cursor",
  copilot: "copilot",
  claude_code: "claude_code",
  codex: "codex",
  gemini_cli: "gemini",
  kiro: "kiro",
  kimi_cli: "kimi",
  opencode: "opencode",
  // API key providers
  anthropic_api: "claude",
  openai_api: "openai",
  deepseek_api: "deepseek",
  gemini_api: "gemini",
  groq_api: "groq",
  xai_api: "grok",
  zhipu_api: "zhipu",
  dashscope_api: "qwen",
  minimax_api: "minimax",
  moonshot_api: "kimi",
  openrouter_api: "openrouter",
  zenmux_api: "zenmux",
  vllm_api: "vllm",
  azure_openai_api: "azure",
  azure_anthropic_api: "azure",
  orgii_orchestrator: "orgii",
  // Short aliases (for validation convenience)
  openai: "openai",
  anthropic: "claude",
  google: "gemini",
};

/**
 * Get icon provider from ModelType.
 * @param modelType - The business-logic model type (e.g. "cursor_cli", "anthropic_api")
 */
export function getIconProvider(modelType: ModelType): IconProvider {
  return MODEL_TYPE_TO_ICON[modelType] || "unknown";
}

/**
 * Detect icon provider from model name.
 * @param modelName - The model name string (e.g. "gpt-4o", "composer-1", "auto")
 * @param agentType - Optional agent type hint for generic names like "auto"
 */
const CURSOR_MODEL_NAME_ICONS = new Set(["auto", "default", "premium"]);

export function getIconProviderFromModelName(
  modelName: string,
  agentType?: string
): IconProvider {
  const lower = modelName.toLowerCase();

  // Generic model names that depend on agent type context
  if (lower === "auto" && agentType) {
    return MODEL_TYPE_TO_ICON[agentType as ModelType] || "unknown";
  }

  // Cursor models (composer and Cursor plan/tier names)
  if (lower.includes("composer") || CURSOR_MODEL_NAME_ICONS.has(lower)) {
    return "cursor";
  }

  // GitHub Copilot models (copilot-chat, copilot-premium, etc.)
  if (lower.includes("copilot")) {
    return "copilot";
  }

  // OpenAI models (GPT series + O-series: o1, o3, o4, etc.)
  if (lower.includes("gpt") || /^o\d/.test(lower)) {
    return "openai";
  }

  // Anthropic/Claude models (including model family names + Cursor's
  // "op-*-relay" tier name, which is an Opus-class proxy and should
  // share the Claude brand mark — same shape of normalization as
  // OpenAI's `^o\d` rule above for o-series models like "o5.5-high").
  if (
    lower.includes("claude") ||
    lower.includes("haiku") ||
    lower.includes("opus") ||
    lower.includes("sonnet") ||
    /^op[-_]/.test(lower)
  ) {
    return "claude";
  }

  // Google/Gemini models
  if (lower.includes("gemini")) {
    return "gemini";
  }

  // xAI/Grok models
  if (lower.includes("grok")) {
    return "grok";
  }

  // DeepSeek models
  if (lower.includes("deepseek")) {
    return "deepseek";
  }

  // Mistral models
  if (lower.includes("mistral") || lower.includes("mixtral")) {
    return "mistral";
  }

  // Alibaba/Qwen models
  if (lower.includes("qwen")) {
    return "qwen";
  }

  // Meta/Llama models
  if (lower.includes("llama") || lower.includes("meta")) {
    return "meta";
  }

  // Perplexity models
  if (lower.includes("perplexity") || lower.includes("pplx")) {
    return "perplexity";
  }

  // ZenMux provider/model slugs
  if (lower.includes("zenmux")) {
    return "zenmux";
  }

  // Moonshot/Kimi models
  if (lower.includes("kimi") || lower.includes("moonshot")) {
    return "kimi";
  }

  // ByteDance/Doubao models
  if (lower.includes("bytedance")) {
    return "bytedance";
  }

  // Doubao (ByteDance's model name)
  if (lower.includes("doubao")) {
    return "doubao";
  }

  // Volcengine models
  if (lower.includes("volcengine") || lower.includes("volc")) {
    return "volcengine";
  }

  // 01.AI/Yi models
  if (lower.includes("yi-") || lower === "yi" || lower.includes("01.ai")) {
    return "yi";
  }

  // Zhipu/GLM models
  if (
    lower.includes("zhipu") ||
    lower.includes("glm") ||
    lower.includes("chatglm")
  ) {
    return "zhipu";
  }

  // Baichuan models
  if (lower.includes("baichuan")) {
    return "baichuan";
  }

  // Minimax models
  if (lower.includes("minimax") || lower.includes("abab")) {
    return "minimax";
  }

  return "unknown";
}

/**
 * Check if icon provider has an icon
 */
export function hasModelIcon(provider: IconProvider): boolean {
  return provider !== "unknown" && ICON_MAP[provider] !== undefined;
}

// ============================================
// Theming
// ============================================

/**
 * Icons that use fill="currentColor" and should respond to text color classes.
 * Brand-colored icons have their colors baked in and should NOT be themed.
 */
export const THEMEABLE_ICONS = new Set<IconProvider>([
  "unknown",
  "aws",
  "cursor",
  "grok",
  "groq",
  "openrouter",
  "zenmux",
  "yi",
  "orgii",
  // Inactive agents that use currentColor
  "goose",
  "cline",
  "opencode",
  "kimi",
]);
