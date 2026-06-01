import { type MutableRefObject, useEffect } from "react";

import { useKeyValidation } from "@src/hooks/keyVault/useKeyValidation";
import {
  getClaudeCodeOAuthDefaultEnabledModels,
  getCodexOAuthDefaultEnabledModels,
} from "@src/hooks/models/nativeHarnessAccountModels";
import { getDefaultEnabledModels } from "@src/util/modelGrouping";

import type { WizardData } from "../types";
import { getEffectiveValidationModels } from "./apiSetupDerived";

interface UseApiSetupValidationOptions {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
  isCursor: boolean;
  isCodex: boolean;
  isClaudeCode: boolean;
  inputMode: "direct" | "natural";
  resolvedCursorSessionToken: string | undefined;
  agentModelsRef: MutableRefObject<string[]>;
}

export function useApiSetupValidation({
  data,
  onChange,
  isCursor,
  isCodex,
  isClaudeCode,
  inputMode,
  resolvedCursorSessionToken,
  agentModelsRef,
}: UseApiSetupValidationOptions) {
  const validation = useKeyValidation({
    agentType: data.agent_type,
    rawKeyInput: data.raw_key_input,
    cursorSessionToken: isCodex
      ? data.oauth_session_token ||
        (data.raw_key_input.trim().startsWith("eyJ")
          ? data.raw_key_input.trim()
          : undefined)
      : resolvedCursorSessionToken,
    baseUrl: data.extracted_base_url,
    inputMode: inputMode,
    onValidationSuccess: ({ models, envVars, extractedConfig: config }) => {
      const effectiveModels = getEffectiveValidationModels(
        models,
        data.agent_type,
        agentModelsRef.current
      );
      const codexDefaultEnabledModels =
        getCodexOAuthDefaultEnabledModels().filter((modelId) =>
          effectiveModels.includes(modelId)
        );
      onChange({
        available_models: effectiveModels,
        enabled_models: isClaudeCode
          ? getClaudeCodeOAuthDefaultEnabledModels()
          : isCodex
            ? codexDefaultEnabledModels.length > 0
              ? codexDefaultEnabledModels
              : effectiveModels.slice(0, 1)
            : getDefaultEnabledModels(effectiveModels),
        model_aliases: [],
        env_vars: envVars,
        validated: true,
        quota_info: config?.quotaInfo as WizardData["quota_info"],
        extracted_api_key: config?.actualApiKey,
        extracted_base_url: config?.baseUrl,
      });
    },
  });

  useEffect(() => {
    if (
      !isCursor ||
      !validation.fetchedModels ||
      validation.fetchedModels.length === 0
    )
      return;
    if ((data.available_models?.length ?? 0) > 0) return;
    onChange({
      available_models: validation.fetchedModels,
      enabled_models: getDefaultEnabledModels(validation.fetchedModels),
      validated: true,
    });
  }, [
    isCursor,
    validation.fetchedModels,
    data.available_models?.length,
    onChange,
  ]);

  return validation;
}
