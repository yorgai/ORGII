/**
 * EditPanel Component
 *
 * Side panel for workflow editing with variants:
 * 1. Nothing selected: Show placeholder
 * 2. Adding: Select action to add to workflow
 * 3. Editing: Edit properties of selected action
 */
import cn from "classnames";
import { MousePointerClick, Plus, Search, X } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Checkbox from "@src/components/Checkbox";
import Input from "@src/components/Input";
import Select from "@src/components/Select";
import Textarea from "@src/components/Textarea";
import { SECTION_GAP_CLASSES } from "@src/modules/shared/layouts/SectionLayout";
import {
  Placeholder,
  ScrollFadeContainer,
} from "@src/modules/shared/layouts/blocks";

import type { SpotlightData } from "../components/CommandCard/types";
import {
  type ActionDefinition,
  SESSION_STAGE_OPTIONS,
  availableActions,
} from "../data";
import {
  useWorkflowAgentOptions,
  useWorkflowModelOptions,
} from "../hooks/useWorkflowModelOptions";
import { renderActionIcon } from "../iconHelper";
import {
  translateActionDescription,
  translateActionTitle,
  translateInputLabel,
  translateInputPlaceholder,
  translateInputUnit,
  translateOptionLabel,
} from "../utils/translateAction";

export type EditPanelVariant = "nothing" | "adding" | "editing";

/** Map the canonical English category to its i18n key suffix. */
function categoryKeySuffix(category: string): string {
  switch (category) {
    case "Controls":
      return "controls";
    case "Session Workflow":
      return "sessionWorkflow";
    case "Actions":
      return "actions";
    default:
      return category.toLowerCase().replace(/\s+/g, "");
  }
}

interface EditPanelProps {
  variant: EditPanelVariant;
  onAddAction?: (action: ActionDefinition) => void;
  onClose?: () => void;
  insertIndex?: number | null;
  // For editing variant
  selectedInstanceId?: string | null;
  selectedInstance?: unknown;
  selectedDefinition?: ActionDefinition | null;
  onUpdateAction?: (
    instanceId: string,
    newData: Record<string, unknown>
  ) => void;
  // For validation
  parentBranchType?: "if-true" | "if-false" | "loop-body";
  // For dynamic select inputs
  spotlightData?: SpotlightData;
}

const EditPanel: React.FC<EditPanelProps> = ({
  variant,
  onAddAction,
  onClose,
  insertIndex,
  selectedInstanceId,
  selectedInstance,
  selectedDefinition,
  onUpdateAction,
  parentBranchType,
  spotlightData,
}) => {
  const { t } = useTranslation("settings");
  const { t: tIntegrations } = useTranslation("integrations");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const modelOptions = useWorkflowModelOptions();
  const agentOptions = useWorkflowAgentOptions();

  // Categories are keyed by the canonical (English) `category` field so
  // filter logic stays locale-independent; the visible label is
  // translated via `categoryKey` at render time.
  const categories = useMemo(() => {
    const cats = new Set(availableActions.map((action) => action.category));
    return ["All", ...Array.from(cats)];
  }, []);

  const filteredActions = useMemo(() => {
    const search_lc = search.toLowerCase();
    return availableActions.filter((action) => {
      const title = translateActionTitle(tIntegrations, action).toLowerCase();
      const description =
        translateActionDescription(tIntegrations, action)?.toLowerCase() ?? "";
      const matchesSearch =
        title.includes(search_lc) || description.includes(search_lc);
      const matchesCategory =
        activeCategory === "All" || action.category === activeCategory;

      // Validation: Do NOT allow loops within loops
      const isInsideLoop = parentBranchType === "loop-body";
      const isLoopAction = action.type === "loop";
      if (isInsideLoop && isLoopAction) {
        return false; // Filter out loop action when inside a loop
      }

      return matchesSearch && matchesCategory;
    });
  }, [search, activeCategory, parentBranchType, tIntegrations]);

  // Group actions by category
  const groupedActions = useMemo(() => {
    const groups: Record<string, ActionDefinition[]> = {};
    filteredActions.forEach((action) => {
      if (!groups[action.category]) {
        groups[action.category] = [];
      }
      groups[action.category].push(action);
    });
    return groups;
  }, [filteredActions]);

  const handleActionClick = useCallback(
    (action: ActionDefinition) => {
      if (variant === "adding") {
        onAddAction?.(action);
      }
    },
    [variant, onAddAction]
  );

  // Render header based on variant
  const renderHeader = () => {
    if (variant === "adding") {
      return (
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-text-1">
            {t("editPanel.addAction")}
            {insertIndex !== null && insertIndex !== undefined && (
              <span className="ml-2 text-xs font-normal text-text-3">
                {t("editPanel.atPosition", { position: insertIndex + 1 })}
              </span>
            )}
          </h3>
        </div>
      );
    }

    if (variant === "editing") {
      const editingTitle = selectedDefinition
        ? translateActionTitle(tIntegrations, selectedDefinition)
        : "";
      const editingDescription = selectedDefinition
        ? translateActionDescription(tIntegrations, selectedDefinition)
        : "";
      return (
        <div className="mb-4 flex items-center justify-between">
          <div className="flex-1 overflow-hidden">
            <h3 className="truncate text-[14px] font-semibold text-text-1">
              {editingTitle || t("editPanel.editAction")}
            </h3>
            <p className="truncate text-[11px] text-text-3">
              {editingDescription}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-text-3 transition-colors hover:bg-fill-2 hover:text-text-1"
          >
            <X size={14} />
          </button>
        </div>
      );
    }

    // For "nothing" variant, still show a section title
    return (
      <div className="mb-4">
        <span className="text-[13px] font-medium text-text-1">
          {t("editPanel.actionsTitle")}
        </span>
      </div>
    );
  };

  // Handle property value change for editing variant
  const handlePropertyChange = useCallback(
    (inputIndex: number, value: unknown) => {
      if (!selectedInstanceId || !selectedInstance || !onUpdateAction) return;

      const currentData = selectedInstance as Record<string, unknown>;
      const updatedData = {
        ...currentData,
        [inputIndex]: value,
      };
      onUpdateAction(selectedInstanceId, updatedData);
    },
    [selectedInstanceId, selectedInstance, onUpdateAction]
  );

  // Render content based on variant
  const renderContent = () => {
    // "nothing" variant - show placeholder
    if (variant === "nothing") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-fill-2">
            <MousePointerClick size={24} className="text-text-3" />
          </div>
          <p className="text-[13px] font-medium text-text-2">
            {t("editPanel.clickToAdd")}
          </p>
        </div>
      );
    }

    // "editing" variant - show action properties
    if (variant === "editing") {
      if (!selectedDefinition || !selectedInstance) {
        return (
          <Placeholder
            variant="empty"
            placement="detail-panel"
            title={t("editPanel.noActionSelected")}
          />
        );
      }

      const instanceData = selectedInstance as Record<string, unknown>;

      return (
        <ScrollFadeContainer
          className={`flex flex-1 overflow-y-auto scrollbar-hide ${SECTION_GAP_CLASSES}`}
        >
          {/* Action Icon and Category */}
          <div className="flex items-center gap-3 rounded-lg bg-fill-2 p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-fill-3">
              {renderActionIcon(selectedDefinition.icon, {
                size: 18,
                className: "text-text-1",
              })}
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="text-[11px] font-medium uppercase tracking-wide text-text-3">
                {selectedDefinition.category}
              </div>
            </div>
          </div>

          {/* Properties Section */}
          {selectedDefinition.inputs && selectedDefinition.inputs.length > 0 ? (
            <>
              <div className="text-[11px] font-medium uppercase tracking-wide text-text-3">
                {t("editPanel.propertiesTitle")}
              </div>
              <div className="flex flex-col gap-2">
                {selectedDefinition.inputs.map((input, index) => {
                  const currentValue =
                    instanceData[index] ?? input.defaultValue;
                  const inputLabel = translateInputLabel(tIntegrations, input);
                  const inputPlaceholder = translateInputPlaceholder(
                    tIntegrations,
                    input
                  );
                  const inputUnit = translateInputUnit(tIntegrations, input);

                  return (
                    <div key={index} className="flex flex-col gap-1.5">
                      {/* Label */}
                      {inputLabel && (
                        <label className="text-[11px] font-medium text-text-2">
                          {inputLabel}
                          {inputUnit && (
                            <span className="ml-1 text-text-3">
                              ({inputUnit})
                            </span>
                          )}
                        </label>
                      )}

                      {/* Input based on type */}
                      {input.type === "text" || input.type === "command" ? (
                        <Input
                          value={String(currentValue || "")}
                          onChange={(newValue) =>
                            handlePropertyChange(index, newValue)
                          }
                          placeholder={inputPlaceholder}
                          size="default"
                        />
                      ) : input.type === "prompt" ? (
                        <Textarea
                          value={String(currentValue || "")}
                          onChange={(newValue) =>
                            handlePropertyChange(index, newValue)
                          }
                          placeholder={inputPlaceholder}
                          rows={3}
                        />
                      ) : input.type === "number" ? (
                        <Input
                          type="number"
                          value={String(currentValue || "")}
                          onChange={(newValue) =>
                            handlePropertyChange(index, Number(newValue))
                          }
                          placeholder={inputPlaceholder}
                          size="default"
                        />
                      ) : input.type === "boolean" ? (
                        <Checkbox
                          checked={Boolean(currentValue)}
                          onChange={(checked) =>
                            handlePropertyChange(index, checked)
                          }
                        >
                          {inputPlaceholder || t("editPanel.enableFallback")}
                        </Checkbox>
                      ) : input.type === "select" && input.options ? (
                        <Select
                          value={String(currentValue || "")}
                          onChange={(value) =>
                            handlePropertyChange(index, value)
                          }
                          options={input.options.map((opt) => ({
                            label: translateOptionLabel(tIntegrations, opt),
                            value: String(opt.value),
                          }))}
                          size="default"
                          placeholder={t("editPanel.selectOption")}
                          dropdownWidthMode="match"
                        />
                      ) : input.type === "session-select" ? (
                        <Select
                          value={String(currentValue || "")}
                          onChange={(value) =>
                            handlePropertyChange(index, value)
                          }
                          options={(spotlightData?.sessions || []).map(
                            (session) => ({
                              label: session.name,
                              value: session.session_id,
                            })
                          )}
                          size="default"
                          placeholder={
                            inputPlaceholder || t("editPanel.selectSession")
                          }
                          dropdownWidthMode="match"
                        />
                      ) : input.type === "repo-select" ? (
                        <Select
                          value={String(currentValue || "")}
                          onChange={(value) =>
                            handlePropertyChange(index, value)
                          }
                          options={(spotlightData?.repos || []).map((repo) => ({
                            label: repo.name,
                            value: repo.id,
                          }))}
                          size="default"
                          placeholder={
                            inputPlaceholder || t("editPanel.selectRepo")
                          }
                          dropdownWidthMode="match"
                        />
                      ) : input.type === "branch-select" ? (
                        <Select
                          value={String(currentValue || "")}
                          onChange={(value) =>
                            handlePropertyChange(index, value)
                          }
                          options={(spotlightData?.branches || []).map(
                            (branch) => ({
                              label: branch.name,
                              value: branch.name,
                            })
                          )}
                          size="default"
                          placeholder={
                            inputPlaceholder || t("editPanel.selectBranch")
                          }
                          dropdownWidthMode="match"
                        />
                      ) : input.type === "model-select" ? (
                        <Select
                          value={String(currentValue || "")}
                          onChange={(value) =>
                            handlePropertyChange(index, value)
                          }
                          options={modelOptions}
                          size="default"
                          placeholder={
                            inputPlaceholder ||
                            (modelOptions.length === 0
                              ? t("editPanel.noModelsConnected", {
                                  defaultValue:
                                    "No models connected — add one in Integrations",
                                })
                              : t("editPanel.selectModel"))
                          }
                          dropdownWidthMode="match"
                        />
                      ) : input.type === "agent-select" ? (
                        <Select
                          value={String(currentValue || "")}
                          onChange={(value) =>
                            handlePropertyChange(index, value)
                          }
                          options={agentOptions}
                          size="default"
                          placeholder={
                            inputPlaceholder || t("editPanel.selectAgent")
                          }
                          dropdownWidthMode="match"
                        />
                      ) : input.type === "stage-select" ? (
                        <Select
                          value={String(currentValue || "")}
                          onChange={(value) =>
                            handlePropertyChange(index, value)
                          }
                          options={SESSION_STAGE_OPTIONS.map((stage) => ({
                            label: stage.label,
                            value: stage.value,
                          }))}
                          size="default"
                          placeholder={
                            inputPlaceholder || t("editPanel.selectStage")
                          }
                          dropdownWidthMode="match"
                        />
                      ) : input.type === "session-creator" ? (
                        <div className="rounded-lg border border-border-2 bg-fill-2 px-3 py-2 text-[11px] text-text-3">
                          {t("editPanel.sessionCreatorComingSoon")}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-border-2 bg-fill-2 px-3 py-2 text-[11px] text-text-3">
                          {t("editPanel.notImplemented", { type: input.type })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <Placeholder
              variant="empty"
              title={t("editPanel.noConfigurableProperties")}
            />
          )}
        </ScrollFadeContainer>
      );
    }

    // For "adding" variant, show action list
    return (
      <>
        {/* Category Filter */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {categories.map((cat) => {
            const label =
              cat === "All"
                ? tIntegrations("agentOrgs.workflowActions.categories.all", {
                    defaultValue: "All",
                  })
                : tIntegrations(
                    `agentOrgs.workflowActions.categories.${categoryKeySuffix(cat)}`,
                    { defaultValue: cat }
                  );
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] transition-colors",
                  activeCategory === cat
                    ? "bg-primary-1 font-medium text-primary-6"
                    : "bg-fill-2 text-text-2 hover:bg-fill-3"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="mb-4">
          <Input
            prefix={<Search size={14} strokeWidth={1.75} />}
            placeholder={t("editPanel.searchActions")}
            value={search}
            onChange={setSearch}
            size="default"
          />
        </div>

        {/* Actions List Grouped by Category */}
        <ScrollFadeContainer className="flex-1 overflow-y-auto scrollbar-hide">
          {Object.keys(groupedActions).length > 0 ? (
            <div className="flex flex-col gap-4">
              {Object.entries(groupedActions)
                .sort(([catA], [catB]) => {
                  // Put "Trigger" first, then sort others alphabetically
                  if (catA === "Trigger") return -1;
                  if (catB === "Trigger") return 1;
                  return catA.localeCompare(catB);
                })
                .map(([category, actions]) => (
                  <div key={category} className="flex flex-col">
                    {/* Category Header */}
                    <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-3">
                      {tIntegrations(
                        `agentOrgs.workflowActions.categories.${categoryKeySuffix(category)}`,
                        { defaultValue: category }
                      )}
                    </h4>
                    {/* Actions in this category */}
                    <div className="flex flex-col gap-1">
                      {actions.map((action) => (
                        <div
                          key={action.id}
                          onClick={() => handleActionClick(action)}
                          className="group flex cursor-pointer items-center gap-2 rounded-lg bg-fill-2 px-3 py-2 transition-colors hover:bg-primary-1 active:bg-primary-1"
                        >
                          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                            <span className="block truncate text-xs font-medium text-text-1 group-hover:text-primary-6">
                              {translateActionTitle(tIntegrations, action)}
                            </span>
                            <span className="block truncate text-[10px] text-text-3">
                              {translateActionDescription(
                                tIntegrations,
                                action
                              )}
                            </span>
                          </div>
                          <Plus
                            size={14}
                            className="invisible flex-shrink-0 text-text-3 group-hover:visible group-hover:text-primary-6 group-active:visible"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <Placeholder
              variant="empty"
              title={t("editPanel.noActionsFound")}
            />
          )}
        </ScrollFadeContainer>
      </>
    );
  };

  return (
    <div className="station-sidebar-scroll-area flex h-full w-[280px] shrink-0 flex-col border-l border-border-2 bg-workstation-bg">
      <div className="shrink-0 px-4 pt-4">{renderHeader()}</div>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        {renderContent()}
      </div>
    </div>
  );
};

export default EditPanel;
