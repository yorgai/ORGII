import { Keyboard, LogIn, ScanSearch } from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import InlineAlert from "@src/components/InlineAlert";
import Input from "@src/components/Input";
import { GeminiSessionSetup } from "@src/features/SessionSetup";
import {
  SECTION_CONTROL_STYLE,
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import {
  SelectionGrid,
  type SelectionGridOption,
} from "@src/scaffold/WizardSystem/primitives";

import type { GeminiSetupProps } from "./types";

type GeminiMethod = "signin" | "autodetect" | "enter_token";

const GeminiSetup: React.FC<GeminiSetupProps> = ({
  data,
  onChange,
  keyValidated,
  validatingKey,
  validationError,
  validateKey,
  tokenDetected,
  detectingToken,
  tokenError,
  onDetectToken,
  onClearTokenError,
  onSessionCaptured,
  preselectedMethod,
  browserOpen,
  setBrowserOpen,
  browserCloseSignal,
}) => {
  const { t } = useTranslation("integrations");

  const methodOptions: SelectionGridOption<GeminiMethod>[] = useMemo(
    () => [
      { key: "signin", label: t("keyVault.signIn"), icon: LogIn },
      {
        key: "autodetect",
        label: t("keyVault.autodetect"),
        icon: ScanSearch,
      },
      {
        key: "enter_token",
        label: t("keyVault.enterKey"),
        icon: Keyboard,
      },
    ],
    [t]
  );

  const selectedMethod = (data.setup_method ?? "signin") as GeminiMethod;
  const hideSelector = !!preselectedMethod;

  const handleApiKeyChange = useCallback(
    (value: string) => {
      onChange({
        raw_key_input: value,
        auth_method: value.trim() ? "api_key" : undefined,
        validated: false,
      });
    },
    [onChange]
  );

  const handleValidateManualKey = useCallback(() => {
    void validateKey();
  }, [validateKey]);

  return (
    <div
      className={
        browserOpen
          ? "flex h-full min-h-0 flex-1 flex-col"
          : SECTION_GAP_CLASSES
      }
      data-testid="gemini-setup"
    >
      {!hideSelector && !browserOpen && (
        <SectionContainer>
          <SectionRow
            label={t("keyVault.setupMethod")}
            description={t("keyVault.geminiSetupMethodDesc")}
            layout="vertical"
            required
          >
            <SelectionGrid
              options={methodOptions}
              selected={selectedMethod}
              cardVariant="subtle"
              onSelect={(key) => onChange({ setup_method: key })}
            />
          </SectionRow>
        </SectionContainer>
      )}

      {selectedMethod === "signin" && (
        <GeminiSessionSetup
          tokenDetected={tokenDetected}
          tokenError={tokenError}
          onClearTokenError={onClearTokenError}
          onSessionCaptured={onSessionCaptured}
          onBrowserStateChange={setBrowserOpen}
          closeSignal={browserCloseSignal}
        />
      )}

      {selectedMethod === "autodetect" && (
        <SectionContainer>
          <SectionRow
            label={t("keyVault.geminiAutodetectTitle")}
            description={t("keyVault.geminiAutodetectDesc")}
            required
          >
            <Button
              variant={tokenDetected ? "success" : "primary"}
              appearance={tokenDetected ? "outline" : undefined}
              size="default"
              loading={detectingToken}
              disabled={detectingToken}
              onClick={onDetectToken}
              className="h-8 min-h-8"
              data-testid="gemini-autodetect"
            >
              {tokenDetected
                ? `✓ ${t("keyVault.detected")}`
                : t("keyVault.detect")}
            </Button>
          </SectionRow>
        </SectionContainer>
      )}

      {selectedMethod === "enter_token" && (
        <SectionContainer>
          <SectionRow
            label={t("keyVault.geminiApiKeyLabel")}
            description={t("keyVault.geminiApiKeyDesc")}
            required
          >
            <div className="flex w-full gap-2">
              <Input
                value={data.raw_key_input}
                onChange={handleApiKeyChange}
                placeholder={t("keyVault.geminiApiKeyPlaceholder")}
                size="default"
                type="password"
                style={{ ...SECTION_CONTROL_STYLE, flex: 1 }}
              />
              <Button
                variant={keyValidated ? "success" : "primary"}
                appearance={keyValidated ? "outline" : undefined}
                size="default"
                loading={validatingKey}
                disabled={validatingKey}
                onClick={handleValidateManualKey}
                className="h-8 min-h-8"
              >
                {keyValidated
                  ? `✓ ${t("keyVault.validated")}`
                  : t("keyVault.validate")}
              </Button>
            </div>
          </SectionRow>
        </SectionContainer>
      )}

      {(tokenDetected || data.validated) && selectedMethod !== "signin" && (
        <InlineAlert type="success">
          {t("keyVault.geminiConnected")}
        </InlineAlert>
      )}

      {tokenError && selectedMethod !== "signin" && (
        <InlineAlert
          type="danger"
          title={tokenError}
          onClose={onClearTokenError}
        >
          {t("keyVault.geminiDetectErrorHint")}
        </InlineAlert>
      )}

      {validationError && selectedMethod === "enter_token" && (
        <InlineAlert type="danger" title={validationError}>
          {t("keyVault.geminiValidationErrorHint")}
        </InlineAlert>
      )}
    </div>
  );
};

export { GeminiSetup };
