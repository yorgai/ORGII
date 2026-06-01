import type { TFunction } from "i18next";
import { useCallback } from "react";

import type { WizardData } from "../types";
import { extractKeysFromInput } from "./keyHelpers";

interface UseApiSetupExtractionOptions {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
  t: TFunction<"integrations">;
  setExtracting: (value: boolean) => void;
  setExtractError: (value: string | null) => void;
  setInputMode: (value: "direct" | "natural") => void;
}

export function useApiSetupExtraction({
  data,
  onChange,
  t,
  setExtracting,
  setExtractError,
  setInputMode,
}: UseApiSetupExtractionOptions) {
  return useCallback(
    (rawInput: string, onSuccess?: (baseUrl?: string) => void) =>
      extractKeysFromInput(
        rawInput,
        data.agent_type,
        {
          onChange,
          setExtracting,
          setExtractError,
          setInputMode,
          notFoundMsg: t("keyVault.couldNotFindApiKey"),
          failedMsg: t("keyVault.failedToExtractKeys"),
        },
        onSuccess
      ),
    [data.agent_type, onChange, setExtractError, setExtracting, setInputMode, t]
  );
}
