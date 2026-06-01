/**
 * useSessionValidation Hook
 *
 * Validates session configuration before creation.
 * Checks required fields, provider/agent availability, and input constraints.
 */
import { useAtomValue } from "jotai";
import { useCallback } from "react";

import type { AgentInfo, ProviderInfo } from "@src/api/http/config";
import { isHostedKey } from "@src/api/tauri/session";
import { isApiKeyProvider } from "@src/assets/providers";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import {
  dispatchCategoryAtom,
  selectedAgentDefinitionIdAtom,
} from "@src/store/session/creatorStateAtom";
import { getRustAgentType } from "@src/util/session/sessionDispatch";

export interface UseSessionValidationOptions {
  effectiveRepoId: string;
  editorContent: string;
  advancedConfig: AdvancedConfig;
  providers: ProviderInfo[];
  agents: AgentInfo[];
}

/** Session creator validation result (distinct from RPC ValidationResult) */
export interface SessionValidationResult {
  valid: boolean;
  errors: string[];
}

export function useSessionValidation(options: UseSessionValidationOptions) {
  const { effectiveRepoId, editorContent, advancedConfig, providers, agents } =
    options;

  const dispatchCategory = useAtomValue(dispatchCategoryAtom);
  const selectedAgentDefinitionId = useAtomValue(selectedAgentDefinitionIdAtom);

  const validateSessionConfig = useCallback((): SessionValidationResult => {
    const errors: string[] = [];
    const usingHostedKey = isHostedKey(advancedConfig.keySource);
    const usingCodeAccount = !!advancedConfig.selectedAccountId;
    const isCursorIde = dispatchCategory === "cursor_ide";
    const isOSMode =
      dispatchCategory === "rust_agent" &&
      getRustAgentType(selectedAgentDefinitionId) === "os";

    // Cursor IDE is special: Cursor manages its own auth, model, and
    // workspace context. We only require the prompt content. Bail
    // early so the BYOK / market / repo / provider rules below
    // don't produce spurious errors against an "external IDE" flow
    // that doesn't have any of those concepts.
    if (isCursorIde) {
      if (!editorContent?.trim()) {
        errors.push("Please describe what you want to build");
      }
      if (editorContent && editorContent.length > 10000) {
        errors.push("Task description must be under 10,000 characters");
      }
      return { valid: errors.length === 0, errors };
    }

    // Market key is only supported for CLI agent sessions — check early so repo
    // validation below doesn't produce a redundant error for this invalid combo.
    if (usingHostedKey && dispatchCategory === "rust_agent") {
      errors.push(
        "Market key is not supported for Agent sessions. Please use your own API key."
      );
    }

    // Repo required for own_key sessions (both rust_agent and cli_agent).
    // rust_agent + hosted_key is already rejected above, so skip repo check then.
    const needsRepo = !usingHostedKey && !isOSMode;
    if (needsRepo && !effectiveRepoId) {
      errors.push("Please select a repo");
    }

    // Content always required
    if (!editorContent?.trim()) {
      errors.push("Please describe what you want to build");
    }
    if (editorContent && editorContent.length > 10000) {
      errors.push("Task description must be under 10,000 characters");
    }

    // Market key for CLI sessions requires a CLI agent selection
    if (
      usingHostedKey &&
      dispatchCategory === "cli_agent" &&
      !advancedConfig.cliAgentType
    ) {
      errors.push("Please select a model from the selector");
    }

    // own_key requires a source (either a saved account or a CLI agent type).
    // Without one of these, resolveOwnKey would launch a session with no key
    // and the backend would error out cryptically.
    if (
      !usingHostedKey &&
      !usingCodeAccount &&
      !advancedConfig.cliAgentType &&
      !advancedConfig.provider
    ) {
      errors.push("Please select a model and source");
    }

    // Provider/model validation (own_key and rust_agent only)
    if (!usingHostedKey && advancedConfig.provider && !usingCodeAccount) {
      const provider = providers.find(
        (providerItem) => providerItem.provider_name === advancedConfig.provider
      );

      if (!provider) {
        errors.push(`Provider "${advancedConfig.provider}" not found`);
      } else if (!provider.has_api_key) {
        errors.push(
          `Provider "${provider.display_name}" requires API key configuration`
        );
      }

      if (advancedConfig.model && provider) {
        const modelExists = provider.models.some(
          (model) => model.id === advancedConfig.model
        );
        if (!modelExists) {
          errors.push(
            `Model "${advancedConfig.model}" not available for this provider`
          );
        }
      }
    }

    // Agent availability (own_key CLI sessions only)
    if (!usingHostedKey && advancedConfig.agent && !usingCodeAccount) {
      const isApiProvider = isApiKeyProvider(advancedConfig.agent);
      if (!isApiProvider) {
        const agent = agents.find(
          (agentItem) => agentItem.name === advancedConfig.agent
        );
        if (!agent) {
          errors.push(`Agent "${advancedConfig.agent}" not found`);
        } else if (!agent.available) {
          errors.push(`Agent "${agent.display_name}" is not available`);
        }
      }
    }

    // Branch format
    if (advancedConfig.branch) {
      const branchPattern = /^[a-zA-Z0-9/_-]+$/;
      if (!branchPattern.test(advancedConfig.branch)) {
        errors.push("Branch name contains invalid characters");
      }
    }

    return { valid: errors.length === 0, errors };
  }, [
    dispatchCategory,
    selectedAgentDefinitionId,
    effectiveRepoId,
    editorContent,
    advancedConfig,
    providers,
    agents,
  ]);

  return {
    validateSessionConfig,
  };
}
