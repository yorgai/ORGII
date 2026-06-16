import React from "react";

import type { DatabaseConnectionConfig } from "@src/engines/DatabaseCore";
import AddConnectionWizard from "@src/scaffold/WizardSystem/variants/Database/AddConnectionWizard";
import {
  addConnectionConfig,
  loadConnectionConfigs,
} from "@src/store/workstation/database";

import type { CategoryTableContentProps } from "../Tables";
import { CategoryTableContent } from "../Tables";
import type { DatabaseIntegrationEntry, DatabaseProbeResult } from "./types";

export interface DatabasesCategoryViewProps {
  selectedDatabase: DatabaseIntegrationEntry | null;
  probeResult?: DatabaseProbeResult | null;
  probing?: boolean;
  onProbe: () => void;
  onRemove: () => void;
  addWizardOpen: boolean;
  onCloseAddWizard: () => void;
  tableProps: CategoryTableContentProps;
  /** Reserved for parent route handling (unused now that inline rows replaced the split preview). */
  fullPage?: boolean;
  onBack?: () => void;
  onExpand?: () => void;
  onClosePreview?: () => void;
}

export const DatabasesCategoryView: React.FC<DatabasesCategoryViewProps> = ({
  selectedDatabase,
  probeResult,
  probing,
  onProbe,
  onRemove,
  addWizardOpen,
  onCloseAddWizard,
  tableProps,
}) => {
  const handleSaveConnection = (config: DatabaseConnectionConfig) => {
    addConnectionConfig(config);
    onCloseAddWizard();
  };

  if (addWizardOpen) {
    const existingConnectionNames = loadConnectionConfigs().map(
      (config) => config.name
    );

    return (
      <AddConnectionWizard
        onSave={handleSaveConnection}
        onCancel={onCloseAddWizard}
        existingConnectionNames={existingConnectionNames}
      />
    );
  }

  const augmentedProps: CategoryTableContentProps = {
    ...tableProps,
    selectedRowId: selectedDatabase?.id ?? null,
    onDbProbe: onProbe,
    onDbRemove: onRemove,
    dbProbeResult: probeResult,
    dbProbing: probing,
  };

  return <CategoryTableContent {...augmentedProps} category="databases" />;
};
