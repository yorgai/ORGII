import type { TFunction } from "i18next";
import { type MutableRefObject, useCallback } from "react";

import {
  autoDetectKey,
  getCodexOAuthModels as fetchCodexOAuthModels,
} from "@src/api/services/keyValidation";
import type { DetectedKey } from "@src/api/types/keys";
import {
  getClaudeCodeOAuthDefaultEnabledModels,
  getClaudeCodeOAuthModels,
  getCodexOAuthDefaultEnabledModels,
  getCodexOAuthModels,
} from "@src/hooks/models/nativeHarnessAccountModels";

import type { WizardData } from "../types";
import { applyKey } from "./keyHelpers";

interface UseApiSetupTokenDetectionOptions {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
  t: TFunction<"integrations">;
  isCursor: boolean;
  isOAuthAgent: boolean;
  isClaudeCode: boolean;
  isCodex: boolean;
  agentModelsRef: MutableRefObject<string[]>;
  detectedKeys: DetectedKey[];
  selectedCredentialIndex: number;
  setDetectingToken: (value: boolean) => void;
  setTokenDetected: (value: boolean) => void;
  setTokenError: (value: string | null) => void;
  setCursorSessionToken: (value: string) => void;
  setShowKeySelection: (value: boolean) => void;
  setDetectedKeys: (value: DetectedKey[]) => void;
  setSelectedCredentialIndex: (value: number) => void;
}

export function useApiSetupTokenDetection({
  data,
  onChange,
  t,
  isCursor,
  isOAuthAgent,
  isClaudeCode,
  isCodex,
  agentModelsRef,
  detectedKeys,
  selectedCredentialIndex,
  setDetectingToken,
  setTokenDetected,
  setTokenError,
  setCursorSessionToken,
  setShowKeySelection,
  setDetectedKeys,
  setSelectedCredentialIndex,
}: UseApiSetupTokenDetectionOptions) {
  const applySelectedKey = useCallback(
    async (cred: DetectedKey) => {
      let fallbackModels = isClaudeCode
        ? getClaudeCodeOAuthModels()
        : isCodex
          ? agentModelsRef.current.length > 0
            ? agentModelsRef.current
            : getCodexOAuthModels()
          : [];
      if (isCodex && cred.session_token) {
        const idToken = cred.env_vars?.OPENAI_ID_TOKEN;
        try {
          const discovered = await fetchCodexOAuthModels(
            cred.session_token,
            idToken
          );
          if (discovered.length > 0) fallbackModels = discovered;
        } catch (err) {
          console.warn(
            "[ApiSetup] Codex OAuth model discovery failed during auto-detect; using fallback models:",
            err
          );
        }
      }
      const codexDefaultEnabledModels =
        getCodexOAuthDefaultEnabledModels().filter((modelId) =>
          fallbackModels.includes(modelId)
        );
      applyKey(cred, {
        onChange,
        setTokenDetected,
        setCursorSessionToken,
        setTokenError,
        setShowKeySelection,
        isCursor,
        isOAuthAgent,
        fallbackModels,
        defaultEnabledModels: isClaudeCode
          ? getClaudeCodeOAuthDefaultEnabledModels()
          : isCodex
            ? codexDefaultEnabledModels.length > 0
              ? codexDefaultEnabledModels
              : fallbackModels.slice(0, 1)
            : undefined,
        noValidTokenMsg: t("keyVault.noValidTokenFound"),
        validationFailedMsg: t("keyVault.quickActions.keyValidationFailed"),
      });
    },
    [
      agentModelsRef,
      isClaudeCode,
      isCodex,
      isOAuthAgent,
      isCursor,
      onChange,
      setCursorSessionToken,
      setShowKeySelection,
      setTokenDetected,
      setTokenError,
      t,
    ]
  );

  const handleAutoDetectToken = useCallback(async () => {
    setDetectingToken(true);
    setTokenError(null);
    setTokenDetected(false);

    try {
      const result = await autoDetectKey(data.agent_type);

      if (!result.success) {
        setTokenError(result.message || t("keyVault.couldNotDetectKeys"));
        return;
      }

      const keys = result.keys || [];

      if (keys.length === 0) {
        setTokenError(t("keyVault.couldNotDetectKeys"));
        return;
      }

      if (keys.length > 1) {
        setDetectedKeys(keys);
        const validApiKeyIndex = keys.findIndex(
          (cred) => cred.auth_method === "api_key" && cred.validated
        );
        const firstValidIndex = keys.findIndex((cred) => cred.validated);
        setSelectedCredentialIndex(
          validApiKeyIndex >= 0
            ? validApiKeyIndex
            : firstValidIndex >= 0
              ? firstValidIndex
              : 0
        );
        setShowKeySelection(true);
        return;
      }

      applySelectedKey(keys[0]);
    } catch (err) {
      console.error("[ApiSetup] Failed to auto-detect credentials:", err);
      setTokenError(t("keyVault.failedToDetectKeys"));
    } finally {
      setDetectingToken(false);
    }
  }, [
    data.agent_type,
    applySelectedKey,
    setDetectedKeys,
    setDetectingToken,
    setSelectedCredentialIndex,
    setShowKeySelection,
    setTokenDetected,
    setTokenError,
    t,
  ]);

  const handleConfirmKeySelection = useCallback(() => {
    const selected = detectedKeys[selectedCredentialIndex];
    if (selected) {
      applySelectedKey(selected);
    }
  }, [detectedKeys, selectedCredentialIndex, applySelectedKey]);

  return { handleAutoDetectToken, handleConfirmKeySelection };
}
