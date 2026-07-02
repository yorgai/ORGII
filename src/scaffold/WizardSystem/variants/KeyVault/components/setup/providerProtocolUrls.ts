import type { ModelType } from "@src/api/types/keys";

type ProviderProtocol = "openai" | "anthropic";

const ANTHROPIC_PROTOCOL_BASE_URLS: Partial<Record<ModelType, string>> = {
  longcat_api: "https://api.longcat.chat/anthropic",
  zenmux_api: "https://zenmux.ai/api/anthropic",
};

export function getOfficialBaseUrlForProtocol(
  modelType: ModelType,
  protocol: ProviderProtocol | string,
  defaultBaseUrl?: string
): string | undefined {
  if (protocol === "anthropic") {
    return ANTHROPIC_PROTOCOL_BASE_URLS[modelType] ?? defaultBaseUrl;
  }

  return defaultBaseUrl;
}
