/**
 * AutomationTriggerConfig — Trigger configuration form for automation rules.
 *
 * Renders name, enabled toggle, scope,
 * trigger type selection, trigger-specific fields, and advanced options.
 *
 * Uses SectionContainer + SectionRow (matching add model / CLI wizard pattern).
 */
import { useAtomValue } from "jotai";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ModelType } from "@src/api/types/keys";
import { MULTI_SELECT_PANEL_WIDTH } from "@src/components/Dropdown/exports";
import Input from "@src/components/Input";
import ModelIcon from "@src/components/ModelIcon";
import NumberInput from "@src/components/NumberInput";
import Select from "@src/components/Select";
import type { SelectOption } from "@src/components/Select";
import Switch from "@src/components/Switch";
import { resolveAgentIcon } from "@src/config/agentIcons";
import { CLI_AGENT_PREFIX } from "@src/modules/MainApp/AgentOrgs/types";
import {
  AVAILABLE_TRIGGERS,
  TRIGGER_CONFIG,
} from "@src/modules/MainApp/Integrations/RulesMemoryEvolution/config";
import type {
  AutomationTrigger,
  RuleScopeMode,
  TriggerType,
} from "@src/modules/MainApp/Integrations/RulesMemoryEvolution/types";
import {
  SECTION_CONTROL_STYLE,
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { CollapsibleSection } from "@src/modules/shared/layouts/blocks";
import {
  SelectionGrid,
  type SelectionGridOption,
} from "@src/scaffold/WizardSystem/primitives";
import { reposAtom } from "@src/store/repo";

import TriggerFields from "./TriggerFields";
import { defaultTrigger } from "./helpers";
import type { AutomationTriggerConfigProps } from "./types";

export type { TriggerConfigState } from "./types";
export { defaultTriggerConfigState, triggerConfigFromRule } from "./helpers";

const AutomationTriggerConfig: React.FC<AutomationTriggerConfigProps> = ({
  state,
  onChange,
  agents: agentDefs = [],
  cliAgents = [],
}) => {
  const { t } = useTranslation("integrations");
  const repos = useAtomValue(reposAtom);

  const agentOptions = useMemo<SelectOption[]>(() => {
    const builtinOptions: SelectOption[] = agentDefs.map((agent) => {
      const IconComp = resolveAgentIcon(agent.iconId);
      return {
        value: agent.id,
        label: (
          <span className="flex items-center gap-2">
            <IconComp size={14} className="shrink-0 text-text-2" />
            <span>{agent.name}</span>
          </span>
        ),
        triggerLabel: agent.name,
      };
    });

    const cliOptions: SelectOption[] = cliAgents.map((agent) => ({
      value: `${CLI_AGENT_PREFIX}${agent.name}`,
      label: (
        <span className="flex items-center gap-2">
          <ModelIcon
            agentType={agent.name as ModelType}
            size="small"
            className="shrink-0"
          />
          <span>{agent.displayName}</span>
        </span>
      ),
      triggerLabel: agent.displayName,
    }));

    return [...builtinOptions, ...cliOptions];
  }, [agentDefs, cliAgents]);

  const repoOptions = useMemo(
    () =>
      repos.map((repo) => ({
        label: repo.name,
        value: repo.id,
      })),
    [repos]
  );

  const includeRepoOptions = useMemo(
    () =>
      repoOptions.filter(
        (opt) => !(state.scopeExcludeRepoIds ?? []).includes(opt.value)
      ),
    [repoOptions, state.scopeExcludeRepoIds]
  );

  const excludeRepoOptions = useMemo(
    () => repoOptions.filter((opt) => !state.scopeRepoIds.includes(opt.value)),
    [repoOptions, state.scopeRepoIds]
  );

  const triggerOptions: SelectionGridOption[] = useMemo(
    () =>
      AVAILABLE_TRIGGERS.map((triggerType) => ({
        key: triggerType,
        label: TRIGGER_CONFIG[triggerType].label,
        tooltip: TRIGGER_CONFIG[triggerType].description,
      })),
    []
  );

  const scopeOptions: SelectionGridOption<RuleScopeMode>[] = useMemo(
    () => [
      {
        key: "all",
        label: t("agentOrgs.allRepos"),
        tooltip: t("agentOrgs.allReposDesc"),
      },
      {
        key: "specific",
        label: t("agentOrgs.specificRepos"),
        tooltip: t("agentOrgs.specificReposDesc"),
      },
    ],
    [t]
  );

  const handleTriggerSelect = useCallback(
    (type: string) => {
      if (type !== state.trigger?.type) {
        onChange({ ...state, trigger: defaultTrigger(type as TriggerType) });
      }
    },
    [state, onChange]
  );

  return (
    <div className={SECTION_GAP_CLASSES}>
      <SectionContainer>
        <SectionRow
          label={t("agentOrgs.applicableAgent")}
          description={t("agentOrgs.applicableAgentDesc")}
        >
          <Select
            value={state.agentId ?? undefined}
            onChange={(val) =>
              onChange({ ...state, agentId: (val as string) || null })
            }
            options={agentOptions}
            placeholder={t("agentOrgs.selectAgent")}
            showSearch
            allowClear
            size="default"
            style={SECTION_CONTROL_STYLE}
            dropdownMinWidth={MULTI_SELECT_PANEL_WIDTH}
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.scope")}
          description={t("agentOrgs.scopeDesc")}
          required
        >
          <div className="w-full min-w-[360px]">
            <SelectionGrid
              options={scopeOptions}
              selected={state.scopeMode}
              onSelect={(key) =>
                onChange({ ...state, scopeMode: key as RuleScopeMode })
              }
              columns={2}
              cardVariant="subtle"
            />
          </div>
        </SectionRow>
        {state.scopeMode === "specific" && (
          <>
            <SectionRow
              label={t("agentOrgs.includeRepos")}
              description={t("agentOrgs.includeReposDesc")}
              indent
            >
              <Select
                mode="multiple"
                value={state.scopeRepoIds}
                onChange={(val) => {
                  const ids = val as string[];
                  const excludeIds = (state.scopeExcludeRepoIds ?? []).filter(
                    (id) => !ids.includes(id)
                  );
                  onChange({
                    ...state,
                    scopeRepoIds: ids,
                    scopeExcludeRepoIds: excludeIds,
                  });
                }}
                options={includeRepoOptions}
                placeholder={t("agentOrgs.selectRepos")}
                showSearch
                size="default"
                style={SECTION_CONTROL_STYLE}
                dropdownMinWidth={MULTI_SELECT_PANEL_WIDTH}
              />
            </SectionRow>
            <SectionRow
              label={t("agentOrgs.excludeRepos")}
              description={t("agentOrgs.excludeReposDesc")}
              indent
            >
              <Select
                mode="multiple"
                value={state.scopeExcludeRepoIds ?? []}
                onChange={(val) => {
                  const ids = val as string[];
                  const includeIds = state.scopeRepoIds.filter(
                    (id) => !ids.includes(id)
                  );
                  onChange({
                    ...state,
                    scopeRepoIds: includeIds,
                    scopeExcludeRepoIds: ids,
                  });
                }}
                options={excludeRepoOptions}
                placeholder={t("agentOrgs.selectRepos")}
                showSearch
                size="default"
                style={SECTION_CONTROL_STYLE}
                dropdownMinWidth={MULTI_SELECT_PANEL_WIDTH}
              />
            </SectionRow>
          </>
        )}
      </SectionContainer>

      <SectionContainer>
        <SectionRow
          label={t("agentOrgs.routineName")}
          description={t("agentOrgs.routineNameDesc")}
          required
        >
          <Input
            value={state.name}
            onChange={(val) => onChange({ ...state, name: val })}
            placeholder={t("agentOrgs.routineNamePlaceholder")}
            size="default"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>

        <SectionRow
          label={t("agentOrgs.trigger")}
          description={t("agentOrgs.triggerDesc")}
          layout="vertical"
          required
        >
          <SelectionGrid
            options={triggerOptions}
            selected={state.trigger?.type ?? null}
            onSelect={handleTriggerSelect}
            cardVariant="subtle"
          />
        </SectionRow>
      </SectionContainer>

      {state.trigger && (
        <SectionContainer>
          <SectionRow
            label={t(`agentOrgs.triggerConfig.${state.trigger.type}.label`)}
            description={t(
              `agentOrgs.triggerConfig.${state.trigger.type}.desc`
            )}
            layout={
              state.trigger.type === "gitActivity" ||
              state.trigger.type === "scheduledTime" ||
              state.trigger.type === "fileWatch"
                ? "vertical"
                : undefined
            }
          >
            <TriggerFields
              trigger={state.trigger}
              onChange={(trigger) => onChange({ ...state, trigger })}
            />
          </SectionRow>

          {state.trigger.type === "channelMessage" && (
            <SectionRow
              label={t("agentOrgs.patternRegex")}
              description={t(
                "agentOrgs.triggerConfig.channelMessage.patternDesc"
              )}
            >
              <Input
                value={state.trigger.pattern || ""}
                onChange={(val) =>
                  onChange({
                    ...state,
                    trigger: {
                      ...state.trigger!,
                      pattern: val || undefined,
                    } as AutomationTrigger,
                  })
                }
                placeholder={t("agentOrgs.patternRegex")}
                size="default"
                style={SECTION_CONTROL_STYLE}
              />
            </SectionRow>
          )}

          {state.trigger.type === "fileWatch" && (
            <SectionRow
              label={t("agentOrgs.debounce")}
              description={t("agentOrgs.triggerConfig.fileWatch.debounceDesc")}
            >
              <NumberInput
                value={state.trigger.debounceMs}
                min={100}
                step={100}
                suffix="ms"
                controlsPosition="sides"
                onChange={(val) => {
                  if (val !== undefined)
                    onChange({
                      ...state,
                      trigger: {
                        ...state.trigger!,
                        debounceMs: val,
                      } as AutomationTrigger,
                    });
                }}
                style={SECTION_CONTROL_STYLE}
              />
            </SectionRow>
          )}
        </SectionContainer>
      )}

      <CollapsibleSection
        title={t("agentOrgs.advancedSettings")}
        defaultOpen={false}
      >
        <div className={SECTION_GAP_CLASSES}>
          {state.trigger && (
            <SectionContainer>
              <SectionRow
                label={t("agentOrgs.cooldown")}
                description={t("agentOrgs.cooldownDesc")}
              >
                <NumberInput
                  value={state.cooldownSecs ?? 0}
                  min={0}
                  step={20}
                  suffix="s"
                  controlsPosition="sides"
                  onChange={(val) =>
                    onChange({
                      ...state,
                      cooldownSecs: val && val > 0 ? val : undefined,
                    })
                  }
                  style={SECTION_CONTROL_STYLE}
                />
              </SectionRow>
              <SectionRow
                label={t("agentOrgs.maxFires")}
                description={t("agentOrgs.maxFiresDesc")}
              >
                <NumberInput
                  value={state.maxFires ?? 0}
                  min={0}
                  step={1}
                  controlsPosition="sides"
                  onChange={(val) =>
                    onChange({
                      ...state,
                      maxFires: val && val > 0 ? val : undefined,
                    })
                  }
                  style={SECTION_CONTROL_STYLE}
                />
              </SectionRow>
            </SectionContainer>
          )}

          <SectionContainer>
            <SectionRow
              label={t("agentOrgs.enabled")}
              description={t("agentOrgs.enabledDesc")}
            >
              <Switch
                checked={state.enabled}
                onChange={(val) => onChange({ ...state, enabled: val })}
              />
            </SectionRow>
          </SectionContainer>
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default AutomationTriggerConfig;
