/**
 * OrgiiApiWizard — paste-an-ORGII-API-key wizard (OSS variant).
 *
 * The original wizard called the now-archived hosted backend
 * (`POST /api-keys`) to mint a brand new key in-app. In the OSS build the
 * backend that mints hosted keys lives only on the ORGII site, so the
 * wizard collapses to:
 *
 *   1. Open the ORGII account page in a new tab to generate a key.
 *   2. Paste the key plus a local display name into this wizard.
 *   3. Hand the (name, key) tuple back to the caller, which persists it
 *      via the local key store (`saveKey({ agent_type: ORGII_ORCHESTRATOR })`).
 *
 * No HTTP calls are made from this wizard.
 */
import { ExternalLink } from "lucide-react";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import { ORGII_HOSTED_API_KEYS_URL } from "@src/config/externalLinks";
import {
  SECTION_CONTROL_STYLE,
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import {
  WizardShell,
  WizardStepLayout,
} from "@src/scaffold/WizardSystem/primitives";

interface OrgiiApiWizardProps {
  onSubmit: (name: string, apiKey: string) => void;
  onCancel: () => void;
  loading?: boolean;
}

const OrgiiApiWizard: React.FC<OrgiiApiWizardProps> = ({
  onSubmit,
  onCancel,
  loading,
}) => {
  const { t } = useTranslation("integrations");

  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");

  const handleOpenOrgii = useCallback(() => {
    window.open(ORGII_HOSTED_API_KEYS_URL, "_blank", "noopener,noreferrer");
  }, []);

  const handleSubmit = useCallback(() => {
    if (!name.trim() || !apiKey.trim()) return;
    onSubmit(name.trim(), apiKey.trim());
  }, [name, apiKey, onSubmit]);

  const canSubmit = !!name.trim() && !!apiKey.trim() && !loading;

  return (
    <WizardShell title={t("orgiiApi.wizardTitle")} onCancel={onCancel}>
      <WizardStepLayout
        currentStep={1}
        totalSteps={1}
        hideStepIndicator
        onCancel={onCancel}
        actions={
          <Button
            variant="primary"
            size="small"
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={loading}
          >
            {t("common:actions.save")}
          </Button>
        }
      >
        <div className={SECTION_GAP_CLASSES}>
          <SectionContainer>
            <SectionRow
              label={t("orgiiApi.nameLabel")}
              description={t("orgiiApi.nameDesc")}
              required
            >
              <Input
                value={name}
                onChange={setName}
                placeholder={t("orgiiApi.namePlaceholder")}
                size="default"
                style={SECTION_CONTROL_STYLE}
              />
            </SectionRow>

            <SectionRow
              label={t("orgiiApi.keyLabel")}
              description={t("orgiiApi.keyDesc")}
              required
            >
              <Input
                value={apiKey}
                onChange={setApiKey}
                placeholder={t("orgiiApi.keyPlaceholder")}
                size="default"
                style={SECTION_CONTROL_STYLE}
                type="password"
              />
            </SectionRow>
          </SectionContainer>

          <SectionContainer>
            <SectionRow
              label={t("orgiiApi.openOrgiiLabel")}
              description={t("orgiiApi.openOrgiiDesc")}
            >
              <Button
                variant="secondary"
                size="default"
                onClick={handleOpenOrgii}
                icon={<ExternalLink size={14} />}
                className="h-8 min-h-8"
              >
                {t("orgiiApi.openOrgii")}
              </Button>
            </SectionRow>
          </SectionContainer>
        </div>
      </WizardStepLayout>
    </WizardShell>
  );
};

export default OrgiiApiWizard;
