import React from "react";

import { KeyVaultWizard } from "@src/scaffold/WizardSystem/variants/KeyVault";

import type { CategoryTableContentProps } from "../Tables";
import { CategoryTableContent } from "../Tables";
import type { useKeyVaultPage } from "./hooks/useKeyVaultPage";

export const AccountCategoryView: React.FC<{
  accounts: ReturnType<typeof useKeyVaultPage>;
  tableProps: CategoryTableContentProps;
  fullPage: boolean;
  onBack: () => void;
  onExpand?: () => void;
  onClosePreview: () => void;
}> = ({ accounts, tableProps }) => {
  if (accounts.showAddForm) {
    return (
      <KeyVaultWizard
        onSubmit={accounts.handleFormSubmit}
        onCancel={accounts.handleFormCancel}
        loading={accounts.formLoading}
        existingAccountNames={accounts.accounts.map((account) => account.name)}
      />
    );
  }

  return <CategoryTableContent {...tableProps} category="models" />;
};
