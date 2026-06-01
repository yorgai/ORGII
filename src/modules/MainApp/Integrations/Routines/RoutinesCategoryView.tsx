import React from "react";

import type { RoutineDefinition } from "@src/api/http/project";
import type { AvailableAgent } from "@src/config/cliAgents";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";
import type { CategoryTableContentProps } from "@src/modules/MainApp/Integrations/Tables";
import { CategoryTableContent } from "@src/modules/MainApp/Integrations/Tables";
import RoutineWizard from "@src/scaffold/WizardSystem/variants/Policy/RoutineWizard";

export interface RoutinesDetailState {
  selectedRoutine: RoutineDefinition | undefined;
  wizardMode: boolean;
  editingRoutine: RoutineDefinition | undefined;
  agents: AgentDefinition[];
  cliAgents: AvailableAgent[];
  onClose: () => void;
  onWizardSave: (routine: RoutineDefinition) => void;
  onWizardCancel: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onFire: () => void;
}

interface RoutinesCategoryViewProps {
  routines: RoutinesDetailState;
  tableProps: CategoryTableContentProps;
  fullPage: boolean;
  onBack: () => void;
  onExpand?: () => void;
}

export const RoutinesCategoryView: React.FC<RoutinesCategoryViewProps> = ({
  routines,
  tableProps,
}) => {
  if (routines.wizardMode) {
    return (
      <RoutineWizard
        routine={routines.editingRoutine}
        agents={routines.agents}
        cliAgents={routines.cliAgents}
        onSave={routines.onWizardSave}
        onCancel={routines.onWizardCancel}
      />
    );
  }

  const augmentedProps: CategoryTableContentProps = {
    ...tableProps,
    selectedRowId: routines.selectedRoutine?.id ?? null,
    onRoutineEdit: routines.onEdit,
    onRoutineDelete: routines.onDelete,
    onRoutineToggleEnabled: routines.onToggleEnabled,
    onRoutineFire: routines.onFire,
  };

  return <CategoryTableContent {...augmentedProps} category="routines" />;
};
