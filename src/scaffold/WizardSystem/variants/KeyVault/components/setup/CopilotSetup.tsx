/**
 * CopilotSetup Component
 *
 * Setup UI for GitHub Copilot.
 * - "has_key" method: Inline paste input + validate button
 * - "create" method: Internal browser flow for PAT creation
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import InlineAlert from "@src/components/InlineAlert";
import Input from "@src/components/Input";
import { CopilotSessionSetup } from "@src/features/SessionSetup";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import type { AgentSetupProps } from "./types";

interface CopilotSetupProps extends AgentSetupProps {
  preselectedMethod?: string;
}

const CopilotSetup: React.FC<CopilotSetupProps> = ({
  data,
  onChange,
  preselectedMethod,
  keyValidated,
  validatingKey,
  validationError,
  validateKey,
  setBrowserOpen,
}) => {
  const { t } = useTranslation("integrations");
  const [successDismissed, setSuccessDismissed] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const errorDismissed =
    validationError !== null && validationError === dismissedError;

  if (preselectedMethod === "has_key") {
    return (
      <>
        <SectionContainer>
          <SectionRow
            label={t("keyVault.copilotTokenLabel")}
            description={t("keyVault.copilotTokenDesc")}
            layout="vertical"
            required
          >
            <div className="flex items-center gap-2">
              <Input
                value={data.raw_key_input}
                onChange={(value) => onChange({ raw_key_input: value })}
                placeholder={t("keyVault.copilotTokenPlaceholder")}
                size="default"
                style={SECTION_CONTROL_STYLE}
                className="flex-1"
              />
              <Button
                variant={keyValidated ? "success" : "primary"}
                appearance={keyValidated ? "outline" : undefined}
                size="default"
                loading={validatingKey}
                disabled={validatingKey || !data.raw_key_input}
                onClick={validateKey}
              >
                {keyValidated
                  ? `✓ ${t("keyVault.validated")}`
                  : t("keyVault.validate")}
              </Button>
            </div>
          </SectionRow>
        </SectionContainer>

        {validationError && !errorDismissed && (
          <InlineAlert
            type="danger"
            onClose={() => setDismissedError(validationError)}
          >
            {validationError}
          </InlineAlert>
        )}

        {keyValidated && !validationError && !successDismissed && (
          <InlineAlert type="success" onClose={() => setSuccessDismissed(true)}>
            {data.available_models.length > 0
              ? t("keyVault.validationSuccessModels", {
                  count: data.available_models.length,
                })
              : t("keyVault.validationSuccessNoModels")}
          </InlineAlert>
        )}
      </>
    );
  }

  if (preselectedMethod === "create") {
    return (
      <CopilotSessionSetup
        onTokenCaptured={(token) => {
          // Mirror the captured token into env_vars[GITHUB_TOKEN] so the
          // OAuth detection in useWizard.submit() (driven by
          // OAUTH_ENV_VARS_BY_AGENT) tags this key as auth_method:"oauth".
          onChange({
            raw_key_input: token,
            env_vars: [
              ...(data.env_vars ?? []).filter(
                (envVar) => envVar.name !== "GITHUB_TOKEN"
              ),
              { name: "GITHUB_TOKEN", value: token },
            ],
          });
        }}
        initialToken=""
        hideTokenInput={true}
        onBrowserStateChange={setBrowserOpen}
      />
    );
  }

  return null;
};

export { CopilotSetup };
