/**
 * Provider Types
 *
 * Shared types for provider icons and agent configurations.
 * ModelType is re-exported from the canonical source.
 */

// Re-export model types from canonical source
export type {
  CliAgentType,
  ApiProviderType,
  ModelType,
} from "@src/api/types/keys";

/** ORGII's own model provider (like OpenRouter). Member of ApiProviderType. */
export const ORGII_ORCHESTRATOR = "orgii_orchestrator" as const;
