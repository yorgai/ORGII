/**
 * AutomationWorkflowStep — Step 2 of the automation rule wizard.
 *
 * Action chain editor with DnD workflow builder.
 * Lazy-loaded by PolicyRuleWizard so the heavy DnD bundle
 * is only pulled when the user reaches Step 2.
 */
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { getUiScaleFromCssVar, useWebViewSensors } from "@src/lib/dndKit";
import type { AutomationRule } from "@src/modules/MainApp/Integrations/RulesMemoryEvolution/types";
import { DETAIL_PANEL_TOKENS } from "@src/modules/shared/layouts/blocks";
import { WizardStepLayout } from "@src/scaffold/WizardSystem/primitives";

import EditPanel from "../EditPanel";
import { type ActionInstance, availableActions } from "../data";
import { useAddActionState } from "../hooks/useAddActionState";
import { useFlatWorkflowDnd } from "../hooks/useFlatWorkflowDnd";
import { useWorkflowActions } from "../hooks/useWorkflowActions";
import { useWorkflowCollapse } from "../hooks/useWorkflowCollapse";
import { useWorkflowEditPanel } from "../hooks/useWorkflowEditPanel";
import useShortcutData from "../useShortcutData";
import { flattenWorkflowToNodes } from "../utils/flattenWorkflow";
import { WorkflowEditorContent } from "./WorkflowEditorContent";

// ── Types ──

interface AutomationWorkflowStepProps {
  /** Rule with trigger already configured from Step 1. */
  rule: AutomationRule;
  onSave: (rule: AutomationRule) => void;
  onBack: () => void;
}

// ── Component ──

const AutomationWorkflowStep: React.FC<AutomationWorkflowStepProps> = ({
  rule,
  onSave,
  onBack,
}) => {
  const { t } = useTranslation("integrations");

  // ── Action chain state ──
  const [actions, setActions] = useState<ActionInstance[]>(rule.actions ?? []);

  // ── DnD + editor hooks ──
  const definitions = useMemo(() => availableActions, []);
  const flatNodes = useMemo(
    () => flattenWorkflowToNodes(actions, definitions),
    [actions, definitions]
  );
  const sortableIds = useMemo(
    () => flatNodes.map((node) => node.id),
    [flatNodes]
  );

  const sensors = useWebViewSensors();
  const uiScale = useMemo(() => getUiScaleFromCssVar(), []);
  const [hoveredGapIndex, setHoveredGapIndex] = useState<number | null>(null);

  const { branchState, setBranchAddState, clearBranchAddState } =
    useAddActionState();

  const { handleAddAction, handleUpdateAction, handleRemoveAction } =
    useWorkflowActions({ instances: actions, onUpdate: setActions });

  const {
    editPanelVariant,
    insertIndex,
    selectedInstanceId,
    handleRequestAddAction,
    handleAddToBranchEnd,
    handleActionClick,
    handleCloseEditPanel,
    handleAddActionFromPanel,
  } = useWorkflowEditPanel({
    flatNodes,
    instances: actions,
    onUpdate: setActions,
    branchState,
    setBranchAddState,
    clearBranchAddState,
    handleAddAction,
  });

  const {
    collapsedBranches,
    branchActionCounts,
    handleToggleCollapse,
    isNodeCollapsed,
  } = useWorkflowCollapse({ flatNodes });

  const {
    activeId,
    overId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useFlatWorkflowDnd({
    flatNodes,
    definitions,
    onReorder: setActions,
    hoveredGapIndex,
    onClearHoveredGapIndex: () => setHoveredGapIndex(null),
  });

  const shortcutData = useShortcutData();
  const spotlightData = useMemo(
    () => ({
      repos: shortcutData.repos,
      sessions: shortcutData.sessions,
      branches: shortcutData.branches,
      loadingRepos: shortcutData.loadingRepos,
      loadingSessions: shortcutData.loadingSessions,
      loadingBranches: shortcutData.loadingBranches,
      fetchBranches: shortcutData.fetchBranches,
    }),
    [shortcutData]
  );

  const getActionIndex = useCallback(
    (nodeId: string) => {
      const actionNodes = flatNodes.filter((node) => node.type === "action");
      return actionNodes.findIndex((node) => node.id === nodeId);
    },
    [flatNodes]
  );

  const selectedInstance = useMemo(
    () => actions.find((inst) => inst.id === selectedInstanceId) ?? null,
    [actions, selectedInstanceId]
  );
  const selectedDefinition = useMemo(() => {
    if (!selectedInstance) return null;
    return (
      definitions.find((def) => def.id === selectedInstance.definitionId) ??
      null
    );
  }, [selectedInstance, definitions]);

  // ── Save ──
  const handleSave = useCallback(() => {
    onSave({ ...rule, actions });
  }, [rule, actions, onSave]);

  // ── Render ──
  return (
    <WizardStepLayout
      currentStep={2}
      totalSteps={2}
      noPadding
      fillWidth
      actions={
        <>
          <Button size="small" onClick={onBack}>
            {t("common:actions.back")}
          </Button>
          <Button variant="primary" size="small" onClick={handleSave}>
            {t("common:actions.done")}
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto px-4">
          <div className={DETAIL_PANEL_TOKENS.contentWidth}>
            <WorkflowEditorContent
              instances={actions}
              flatNodes={flatNodes}
              sortableIds={sortableIds}
              sensors={sensors}
              activeId={activeId}
              overId={overId}
              collapsedBranches={collapsedBranches}
              branchActionCounts={branchActionCounts}
              hoveredGapIndex={hoveredGapIndex}
              uiScale={uiScale}
              definitions={definitions}
              spotlightData={spotlightData}
              isNodeCollapsed={isNodeCollapsed}
              getActionIndex={getActionIndex}
              handleToggleCollapse={handleToggleCollapse}
              handleDragStart={handleDragStart}
              handleDragOver={handleDragOver}
              handleDragEnd={handleDragEnd}
              handleDragCancel={handleDragCancel}
              onSetHoveredGapIndex={setHoveredGapIndex}
              onUpdateAction={handleUpdateAction}
              onRemoveAction={handleRemoveAction}
              onActionClick={handleActionClick}
              onRequestAddAction={handleRequestAddAction}
              onAddToBranchEnd={handleAddToBranchEnd}
            />
          </div>
        </div>

        <EditPanel
          variant={editPanelVariant}
          onAddAction={handleAddActionFromPanel}
          onClose={handleCloseEditPanel}
          insertIndex={insertIndex}
          selectedInstanceId={selectedInstanceId}
          selectedInstance={selectedInstance ?? undefined}
          selectedDefinition={selectedDefinition ?? undefined}
          onUpdateAction={handleUpdateAction}
          spotlightData={spotlightData}
          parentBranchType={branchState?.branchType}
        />
      </div>
    </WizardStepLayout>
  );
};

export default AutomationWorkflowStep;
