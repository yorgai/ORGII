import { useAtomValue } from "jotai";
import { Plus, SquareArrowOutUpRight, X } from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { OrchestratorConfig } from "@src/api/http/project";
import DropdownFooter from "@src/components/Dropdown/DropdownFooter";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
} from "@src/components/Dropdown/tokens";
import InlineAlert from "@src/components/InlineAlert";
import NumberInput from "@src/components/NumberInput";
import Select from "@src/components/Select";
import Switch from "@src/components/Switch";
import { buildIntegrationsPath } from "@src/config/mainAppPaths";
import { useKeyVault } from "@src/hooks/keyVault/useKeyVault";
import { builtInAgentsAtom } from "@src/modules/MainApp/AgentOrgs/store/builtInAgentsAtom";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";
import {
  SECTION_CONTROL_STYLE,
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { CollapsibleSection } from "@src/modules/shared/layouts/blocks";

import { DEFAULT_ORCHESTRATOR_CONFIG } from "../../constants";

interface AgentSettingsProps {
  config: OrchestratorConfig;
  isWorkflowActive: boolean;
  onUpdateConfig: (updates: Partial<OrchestratorConfig>) => void;
  /** Custom agents from Agent Orgs (for sub-agent selection) */
  availableAgents?: AgentDefinition[];
}

const AgentSettings: React.FC<AgentSettingsProps> = ({
  config,
  isWorkflowActive,
  onUpdateConfig,
  availableAgents = [],
}) => {
  const { t } = useTranslation("projects");
  const navigate = useNavigate();
  const builtInAgents = useAtomValue(builtInAgentsAtom);

  const { localAccounts, loading: accountsLoading } = useKeyVault({
    autoLoad: true,
  });

  const readyAccounts = useMemo(
    () => localAccounts.filter((account) => account.status === "ready"),
    [localAccounts]
  );

  const accountOptions = useMemo(
    () =>
      readyAccounts.map((account) => ({
        value: account.id,
        label: account.name,
      })),
    [readyAccounts]
  );

  const handleToggle = useCallback(
    (field: keyof OrchestratorConfig, value: boolean) => {
      onUpdateConfig({ [field]: value });
    },
    [onUpdateConfig]
  );

  const handleMaxRetryChange = useCallback(
    (value: number | undefined) => {
      if (value !== undefined) onUpdateConfig({ max_retry_count: value });
    },
    [onUpdateConfig]
  );

  const handleSelectAccount = useCallback(
    (value: string | number | (string | number)[]) => {
      onUpdateConfig({
        selected_account_id: String(value),
        selected_model_id: undefined,
      });
    },
    [onUpdateConfig]
  );

  const handleSelectModel = useCallback(
    (value: string | number | (string | number)[]) => {
      onUpdateConfig({ selected_model_id: String(value) });
    },
    [onUpdateConfig]
  );

  const effectiveConfig = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
  const followUpDisabled = !effectiveConfig.review_enabled;
  const maxRetryDisabled = !effectiveConfig.auto_retry_on_failure;

  const selectedAccount = useMemo(
    () =>
      readyAccounts.find(
        (acc) => acc.id === effectiveConfig.selected_account_id
      ),
    [readyAccounts, effectiveConfig.selected_account_id]
  );

  const modelOptions = useMemo(
    () =>
      (selectedAccount?.availableModels ?? []).map((modelId) => ({
        value: modelId,
        label: modelId,
      })),
    [selectedAccount]
  );

  const noAccountSelected = !effectiveConfig.selected_account_id;

  // Sub-agent multi-select
  const subAgentIds = useMemo(
    () => effectiveConfig.sub_agent_ids ?? [],
    [effectiveConfig.sub_agent_ids]
  );
  const addedIdSet = useMemo(() => new Set(subAgentIds), [subAgentIds]);

  const allAgents = useMemo(
    () => [...availableAgents, ...builtInAgents],
    [availableAgents, builtInAgents]
  );

  const addableAgentOptions = useMemo(
    () =>
      allAgents
        .filter((agent) => !addedIdSet.has(agent.id))
        .map((agent) => ({
          value: agent.id,
          label: agent.name,
        })),
    [allAgents, addedIdSet]
  );

  const handleAddSubAgent = useCallback(
    (value: string | number | (string | number)[]) => {
      const agentId = String(value);
      if (!agentId || addedIdSet.has(agentId)) return;
      onUpdateConfig({ sub_agent_ids: [...subAgentIds, agentId] });
    },
    [subAgentIds, addedIdSet, onUpdateConfig]
  );

  const handleRemoveSubAgent = useCallback(
    (agentId: string) => {
      onUpdateConfig({
        sub_agent_ids: subAgentIds.filter((id) => id !== agentId),
      });
    },
    [subAgentIds, onUpdateConfig]
  );

  const resolveAgentName = useCallback(
    (agentId: string) =>
      allAgents.find((agent) => agent.id === agentId)?.name ?? agentId,
    [allAgents]
  );

  const handleOpenIntegrations = useCallback(() => {
    const path = buildIntegrationsPath({ category: "models" });
    navigate(`${path}?modelsTab=my-accounts`);
  }, [navigate]);

  const accountDropdownRender = useCallback(
    (menu: React.ReactNode) => (
      <div>
        {menu}
        <DropdownFooter>
          <button
            type="button"
            className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full justify-between`}
            onMouseDown={(event) => {
              event.preventDefault();
              handleOpenIntegrations();
            }}
          >
            <span>{t("workItems.agentSettings.manageAccounts")}</span>
            <SquareArrowOutUpRight
              size={DROPDOWN_ITEM.iconSize}
              className="text-text-3"
            />
          </button>
        </DropdownFooter>
      </div>
    ),
    [handleOpenIntegrations, t]
  );

  return (
    <CollapsibleSection
      title={t("workItems.agentSettings.title")}
      defaultOpen={false}
    >
      <div className={SECTION_GAP_CLASSES}>
        {isWorkflowActive && (
          <InlineAlert type="info">
            {t("workItems.agentSettings.pendingChanges")}
          </InlineAlert>
        )}

        <SectionContainer>
          <SectionRow
            label={t("workItems.agentSettings.codeAccount")}
            description={t("workItems.agentSettings.codeAccountDesc")}
          >
            <Select
              value={effectiveConfig.selected_account_id || undefined}
              onChange={handleSelectAccount}
              options={accountOptions}
              placeholder={t("workItems.agentSettings.selectAccount")}
              loading={accountsLoading}
              showSearch
              size="default"
              style={SECTION_CONTROL_STYLE}
              dropdownRender={accountDropdownRender}
            />
          </SectionRow>

          <SectionRow
            label={t("workItems.agentSettings.model")}
            description={
              noAccountSelected
                ? t("workItems.agentSettings.selectAccountFirst")
                : t("workItems.agentSettings.modelDesc")
            }
          >
            <Select
              value={effectiveConfig.selected_model_id || undefined}
              onChange={handleSelectModel}
              options={modelOptions}
              placeholder={t("workItems.agentSettings.selectModel")}
              disabled={noAccountSelected}
              showSearch
              size="default"
              style={SECTION_CONTROL_STYLE}
            />
          </SectionRow>
        </SectionContainer>

        {/* Sub-Agents — multi-select add/remove list */}
        <SectionContainer>
          <div className="px-1 py-2 text-[12px] font-medium text-text-2">
            {t("workItems.agentSettings.subAgents")}
          </div>
          <div className="px-1 pb-1 text-[11px] text-text-4">
            {t("workItems.agentSettings.subAgentsDesc")}
          </div>

          {subAgentIds.length === 0 && (
            <div className="px-1 py-3 text-center text-[11px] text-text-4">
              {t("workItems.agentSettings.noSubAgents")}
            </div>
          )}

          {subAgentIds.map((agentId) => (
            <div
              key={agentId}
              className="flex items-center justify-between border-t border-border-1 px-1 py-1.5"
            >
              <span className="text-[12px] font-medium text-text-1">
                {resolveAgentName(agentId)}
              </span>
              <button
                type="button"
                className="rounded p-0.5 text-text-4 transition-colors hover:bg-fill-2 hover:text-danger-6"
                onClick={() => handleRemoveSubAgent(agentId)}
                disabled={isWorkflowActive}
              >
                <X size={DROPDOWN_ITEM.iconSize} />
              </button>
            </div>
          ))}

          {addableAgentOptions.length > 0 && (
            <div className="border-t border-border-1 px-1 pb-1 pt-2">
              <Select
                value={undefined}
                onChange={handleAddSubAgent}
                options={addableAgentOptions}
                placeholder={t("workItems.agentSettings.addSubAgent")}
                showSearch
                size="default"
                style={{ width: "100%" }}
                disabled={isWorkflowActive}
                prefix={
                  <Plus size={DROPDOWN_ITEM.iconSize} className="text-text-3" />
                }
              />
            </div>
          )}
        </SectionContainer>

        <SectionContainer>
          <SectionRow
            label={t("workItems.agentSettings.reviewEnabled")}
            description={t("workItems.agentSettings.reviewEnabledDesc")}
          >
            <Switch
              checked={effectiveConfig.review_enabled}
              onChange={(checked) => handleToggle("review_enabled", checked)}
            />
          </SectionRow>

          <SectionRow
            label={t("workItems.agentSettings.followUpEnabled")}
            description={
              followUpDisabled
                ? t("workItems.agentSettings.disabledRequiresReview")
                : t("workItems.agentSettings.followUpEnabledDesc")
            }
            indent={followUpDisabled}
          >
            <Switch
              checked={effectiveConfig.follow_up_enabled && !followUpDisabled}
              onChange={(checked) => handleToggle("follow_up_enabled", checked)}
              disabled={followUpDisabled}
            />
          </SectionRow>

          <SectionRow
            label={t("workItems.agentSettings.autoCreatePr")}
            description={t("workItems.agentSettings.autoCreatePrDesc")}
          >
            <Switch
              checked={effectiveConfig.auto_create_pr}
              onChange={(checked) => handleToggle("auto_create_pr", checked)}
            />
          </SectionRow>
        </SectionContainer>

        <SectionContainer>
          <SectionRow
            label={t("workItems.agentSettings.autoRetryOnFailure")}
            description={t("workItems.agentSettings.autoRetryOnFailureDesc")}
          >
            <Switch
              checked={effectiveConfig.auto_retry_on_failure}
              onChange={(checked) =>
                handleToggle("auto_retry_on_failure", checked)
              }
            />
          </SectionRow>

          {!maxRetryDisabled && (
            <SectionRow
              label={t("workItems.agentSettings.maxRetryCount")}
              indent
            >
              <NumberInput
                value={effectiveConfig.max_retry_count}
                min={1}
                max={5}
                step={1}
                controlsPosition="sides"
                onChange={handleMaxRetryChange}
                style={SECTION_CONTROL_STYLE}
              />
            </SectionRow>
          )}
        </SectionContainer>
      </div>
    </CollapsibleSection>
  );
};

export default AgentSettings;
