/**
 * ApiKeyProviderSetup Component
 *
 * Simplified credential input for direct API key providers.
 * No auto-detect, no OAuth, no extract -- just clean key + optional base URL entry.
 *
 * Uses SectionContainer + SectionRow (matching MCP/Skills wizard pattern).
 * Base URL has Official URL / Custom URL select; when Official, input is disabled.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import InlineAlert from "@src/components/InlineAlert";
import Input from "@src/components/Input";
import Select from "@src/components/Select";
import {
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { useProviderConfig } from "../../config";
import type { AgentSetupProps } from "./types";

type BaseUrlMode = "official" | "custom";

const ApiKeyProviderSetup: React.FC<AgentSetupProps> = ({
  data,
  onChange,
  keyValidated,
  validatingKey,
  validateKey,
}) => {
  const { t } = useTranslation("integrations");
  const { config: envConfig, loading: configLoading } = useProviderConfig(
    data.agent_type
  );

  // Determine if user's current URL differs from the official default
  const hasCustomBaseUrl = useMemo(() => {
    return Boolean(
      envConfig?.supportsBaseUrl &&
      envConfig?.defaultBaseUrl &&
      data.extracted_base_url &&
      data.extracted_base_url !== envConfig.defaultBaseUrl
    );
  }, [envConfig, data.extracted_base_url]);

  // Track user's explicit mode choice. Defaults to "custom" if data has a non-default URL.
  const [baseUrlModeOverride, setBaseUrlModeOverride] =
    useState<BaseUrlMode | null>(null);
  const baseUrlMode: BaseUrlMode =
    baseUrlModeOverride ?? (hasCustomBaseUrl ? "custom" : "official");
  const setBaseUrlMode = (mode: BaseUrlMode) => setBaseUrlModeOverride(mode);

  const [baseUrlWarningDismissed, setBaseUrlWarningDismissed] = useState(false);

  // Track last synced values to avoid duplicate onChange calls
  const lastSyncedRef = useRef<{ mode: BaseUrlMode; url: string | undefined }>({
    mode: baseUrlMode,
    url: data.extracted_base_url,
  });

  // Sync official URL to data when in official mode (for validation)
  // This is intentional: when mode changes to "official", we need to update parent state
  useEffect(() => {
    const needsSync =
      envConfig?.supportsBaseUrl &&
      baseUrlMode === "official" &&
      envConfig?.defaultBaseUrl &&
      data.extracted_base_url !== envConfig.defaultBaseUrl;

    // Only sync if mode changed to official (not on every render)
    const modeChangedToOfficial =
      lastSyncedRef.current.mode !== "official" && baseUrlMode === "official";

    if (needsSync && modeChangedToOfficial && envConfig.defaultBaseUrl) {
      onChange({ extracted_base_url: envConfig.defaultBaseUrl });
    }

    lastSyncedRef.current = {
      mode: baseUrlMode,
      url: data.extracted_base_url,
    };
  }, [envConfig, baseUrlMode, data.extracted_base_url, onChange]);

  if (configLoading || !envConfig) {
    return null;
  }

  return (
    <div className={SECTION_GAP_CLASSES}>
      <SectionContainer>
        <SectionRow
          label={t("keyVault.apiKeyLabel")}
          description={t("keyVault.apiKeyDesc")}
          layout="vertical"
          required
        >
          <Input
            value={data.raw_key_input}
            onChange={(value: string) => onChange({ raw_key_input: value })}
            placeholder={t("keyVault.apiKeyPlaceholder")}
            size="default"
            className="w-full"
          />
        </SectionRow>

        {envConfig.supportsBaseUrl && (
          <SectionRow
            label={t("keyVault.baseUrlLabel")}
            description={t("keyVault.baseUrlDesc")}
            layout="vertical"
          >
            <div className="flex items-center gap-2">
              <Select
                value={baseUrlMode}
                onChange={(val) => {
                  const mode = val as BaseUrlMode;
                  setBaseUrlMode(mode);
                  if (mode === "official") {
                    setBaseUrlWarningDismissed(false);
                    onChange({
                      extracted_base_url: envConfig.defaultBaseUrl || undefined,
                    });
                  }
                }}
                options={[
                  { value: "official", label: t("keyVault.officialUrl") },
                  { value: "custom", label: t("keyVault.customUrl") },
                ]}
                size="default"
                dropdownWidthMode="min-match"
                className="w-fit shrink-0"
              />
              <Input
                value={
                  baseUrlMode === "official"
                    ? envConfig.defaultBaseUrl || ""
                    : data.extracted_base_url || ""
                }
                onChange={(value: string) =>
                  onChange({ extracted_base_url: value || undefined })
                }
                size="default"
                className="min-w-0 flex-1"
                disabled={baseUrlMode === "official"}
              />
            </div>
          </SectionRow>
        )}
      </SectionContainer>

      {envConfig.supportsBaseUrl &&
        baseUrlMode === "custom" &&
        !baseUrlWarningDismissed && (
          <InlineAlert
            type="warning"
            title={t("keyVault.customBaseUrlRiskTitle")}
            onClose={() => setBaseUrlWarningDismissed(true)}
          >
            {t("keyVault.customBaseUrlRiskWarning")}
          </InlineAlert>
        )}

      <SectionContainer>
        <SectionRow
          label={t("keyVault.validate", "Validate")}
          description={t("keyVault.validateDesc")}
          required
        >
          <Button
            variant={keyValidated ? "success" : "primary"}
            appearance={keyValidated ? "outline" : undefined}
            size="default"
            loading={validatingKey}
            disabled={validatingKey || !data.raw_key_input}
            onClick={validateKey}
            className="h-8 min-h-8"
          >
            {keyValidated
              ? `✓ ${t("keyVault.validated", "Validated")}`
              : t("keyVault.validate", "Validate")}
          </Button>
        </SectionRow>
      </SectionContainer>
    </div>
  );
};

export { ApiKeyProviderSetup };
