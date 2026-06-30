/**
 * Key detection + extraction helpers for useApiSetup.
 */
import { invoke } from "@tauri-apps/api/core";

import type { DetectedKey } from "@src/api/types/keys";
import { createLogger } from "@src/hooks/logger";
import { getDefaultEnabledModels } from "@src/util/modelGrouping";

import type { WizardData } from "../types";

const log = createLogger("ApiSetup");

interface ExtractionResult {
  api_key: string | null;
  base_url: string | null;
  key_type: string | null;
  confidence: string;
  notes: string[];
}

export interface ApplyKeyCallbacks {
  onChange: (updates: Partial<WizardData>) => void;
  setTokenDetected: (v: boolean) => void;
  setCursorSessionToken: (v: string) => void;
  setTokenError: (v: string | null) => void;
  setShowKeySelection: (v: boolean) => void;
  isCursor: boolean;
  isOAuthAgent: boolean;
  fallbackModels?: string[];
  defaultEnabledModels?: string[];
  noValidTokenMsg: string;
  validationFailedMsg: string;
}

export function applyKey(
  cred: DetectedKey,
  callbacks: ApplyKeyCallbacks
): void {
  const {
    onChange,
    setTokenDetected,
    setCursorSessionToken,
    setTokenError,
    setShowKeySelection,
    isCursor,
    isOAuthAgent,
    fallbackModels = [],
    defaultEnabledModels,
    noValidTokenMsg,
    validationFailedMsg,
  } = callbacks;

  if (!cred.validated) {
    setTokenError(cred.validation_message || validationFailedMsg);
    return;
  }

  const sessionToken = cred.session_token || cred.api_key;
  const quotaInfo = cred.quota_info;
  const modelsAvailable =
    cred.available_models && cred.available_models.length > 0
      ? cred.available_models
      : fallbackModels;
  const modelsEnabled =
    defaultEnabledModels ?? getDefaultEnabledModels(modelsAvailable);

  if (!sessionToken) {
    setTokenError(noValidTokenMsg);
    return;
  }

  setTokenDetected(true);
  setCursorSessionToken(sessionToken);
  setTokenError(null);

  if (isCursor) {
    onChange({
      auth_method: "oauth",
      cursor_session_token: sessionToken,
      raw_key_input: "",
      quota_info: quotaInfo,
      available_models: modelsAvailable,
      model_context_lengths: {},
      enabled_models: modelsEnabled,
      validated: true,
    });
  } else if (
    cred.auth_method === "oauth" ||
    (isOAuthAgent && !!cred.session_token)
  ) {
    onChange({
      oauth_session_token: sessionToken,
      cursor_session_token: "",
      raw_key_input: "",
      quota_info: quotaInfo,
      available_models: modelsAvailable,
      model_context_lengths: {},
      enabled_models: modelsEnabled,
      validated: true,
      auth_method: "oauth",
      env_vars: cred.env_vars
        ? Object.entries(cred.env_vars).map(([name, value]) => ({
            name,
            value,
          }))
        : undefined,
    });
  } else {
    const detectedApiKey = cred.api_key || sessionToken;
    const detectedBaseUrl = cred.base_url;
    onChange({
      raw_key_input: detectedApiKey,
      quota_info: quotaInfo,
      available_models: modelsAvailable,
      model_context_lengths: {},
      enabled_models: modelsEnabled,
      validated: cred.validated ?? true,
      extracted_api_key: detectedApiKey,
      extracted_base_url: detectedBaseUrl,
    });
  }

  setShowKeySelection(false);
}

export interface ExtractCallbacks {
  onChange: (updates: Partial<WizardData>) => void;
  setExtracting: (v: boolean) => void;
  setExtractError: (v: string | null) => void;
  setInputMode: (v: "direct" | "natural") => void;
  notFoundMsg: string;
  failedMsg: string;
}

export async function extractKeysFromInput(
  rawInput: string,
  agentType: string,
  callbacks: ExtractCallbacks,
  onSuccess?: (baseUrl?: string) => void
): Promise<void> {
  const {
    onChange,
    setExtracting,
    setExtractError,
    setInputMode,
    notFoundMsg,
    failedMsg,
  } = callbacks;
  setExtracting(true);
  setExtractError(null);

  try {
    const result = await invoke<ExtractionResult>("extract_keys_from_text", {
      input: rawInput,
      agentType,
    });

    if (result.api_key) {
      onChange({
        raw_key_input: result.api_key,
        extracted_api_key: result.api_key,
        extracted_base_url: result.base_url || undefined,
        validated: false,
        auth_method: undefined,
        quota_info: undefined,
        available_models: [],
        model_context_lengths: {},
        enabled_models: [],
      });
      setInputMode("direct");
      onSuccess?.(result.base_url || undefined);
    } else {
      setExtractError(notFoundMsg);
    }
  } catch (err) {
    log.error("[ApiSetup] Extraction failed:", err);
    setExtractError(err instanceof Error ? err.message : failedMsg);
  } finally {
    setExtracting(false);
  }
}
