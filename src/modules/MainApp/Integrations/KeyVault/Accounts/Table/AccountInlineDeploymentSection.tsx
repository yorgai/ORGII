import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { updateKeyHealth } from "@src/api/services/keyValidation";
import InlineAlert from "@src/components/InlineAlert";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import { SECTION_SUBHEADING_CLASSES } from "@src/modules/shared/layouts/SectionLayout";
import DeploymentModelInput from "@src/scaffold/WizardSystem/variants/KeyVault/components/DeploymentModelInput";

interface AccountInlineDeploymentSectionProps {
  account: KeyVaultAccount;
  onRefresh: () => Promise<void>;
}

export const AccountInlineDeploymentSection: React.FC<
  AccountInlineDeploymentSectionProps
> = ({ account, onRefresh }) => {
  const { t } = useTranslation("integrations");
  const { t: tCommon } = useTranslation();

  const [deploymentModels, setDeploymentModels] = useState<string[]>(
    account.availableModels ?? []
  );
  const [savingModels, setSavingModels] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDeploymentModels(account.availableModels ?? []);
  }, [account.id, account.availableModels]);

  const handleDeploymentModelsChange = useCallback(
    async (models: string[]) => {
      setDeploymentModels(models);
      setSavingModels(true);
      setSaveError(null);
      try {
        await updateKeyHealth(
          account.id,
          account.healthStatus ?? "valid",
          undefined,
          models
        );
        await onRefresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setSaveError(msg);
      } finally {
        setSavingModels(false);
      }
    },
    [account.healthStatus, account.id, onRefresh]
  );

  const alertMessages = useMemo(() => {
    if (!saveError) return [];
    return [{ id: "save", type: "danger" as const, text: saveError }];
  }, [saveError]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {alertMessages.map((msg) => (
        <InlineAlert
          key={msg.id}
          type={msg.type}
          onClose={() => setSaveError(null)}
          closeAriaLabel={tCommon("actions.close")}
        >
          {msg.text}
        </InlineAlert>
      ))}
      <div className={SECTION_SUBHEADING_CLASSES}>
        {t("keyVault.deploymentModels.sectionTitle")}
      </div>
      <DeploymentModelInput
        models={deploymentModels}
        onModelsChange={handleDeploymentModelsChange}
      />
      {savingModels ? (
        <p className="text-[11px] text-text-3">{tCommon("status.saving")}</p>
      ) : null}
    </div>
  );
};
