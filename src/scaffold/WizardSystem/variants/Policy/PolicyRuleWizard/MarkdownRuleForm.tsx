import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  MULTI_SELECT_PANEL_WIDTH,
  MULTI_SELECT_TOKENS,
} from "@src/components/Dropdown/exports";
import Input from "@src/components/Input";
import Select from "@src/components/Select";
import TabPill from "@src/components/TabPill";
import type { CursorRepo, PolicySource } from "@src/hooks/policies";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";
import MarkdownEditor, {
  useMarkdownEditorTabs,
} from "@src/modules/shared/components/MarkdownEditor";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { SECTION_CONTROL_STYLE } from "@src/modules/shared/layouts/SectionLayout/tokens";
import { BUILTIN_OS_DEF_ID } from "@src/util/session/sessionDispatch";

import type { MarkdownRuleState } from "./types";

interface MarkdownRuleFormProps {
  state: MarkdownRuleState;
  onChange: (state: MarkdownRuleState) => void;
  agents?: AgentDefinition[];
  cursorRepos?: CursorRepo[];
  /** Editing mode disables the source picker — moving an existing file across scopes is a separate operation. */
  isEditing?: boolean;
}

const MarkdownRuleForm: React.FC<MarkdownRuleFormProps> = ({
  state,
  onChange,
  agents: agentDefs = [],
  cursorRepos = [],
  isEditing = false,
}) => {
  const { t } = useTranslation("integrations");
  const editorTabs = useMarkdownEditorTabs();

  /**
   * User rules load for workspace-scoped sessions and can be narrowed by
   * agent. Repo rules live inside one repo and inherit that repo boundary,
   * matching Cursor's User Rules vs project `.cursor/rules` model.
   */
  const agentOptions = useMemo(() => {
    if (state.source === "personal") return [];
    return agentDefs
      .filter((agent) => agent.id !== BUILTIN_OS_DEF_ID)
      .map((agent) => ({ label: agent.name, value: agent.id }));
  }, [agentDefs, state.source]);

  const repoOptions = useMemo(
    () => cursorRepos.map((repo) => ({ label: repo.name, value: repo.path })),
    [cursorRepos]
  );

  const sourceOptions = useMemo(() => {
    const options = [
      {
        value: "global" as PolicySource,
        label: t("agentOrgs.ruleSourceUser"),
        desc: t("agentOrgs.ruleSourceUserDesc"),
      },
      {
        value: "workspace" as PolicySource,
        label: t("agentOrgs.ruleSourceRepo"),
        desc: t("agentOrgs.ruleSourceRepoDesc"),
      },
    ];
    if (state.source === "personal") {
      options.push({
        value: "personal" as PolicySource,
        label: t("agentOrgs.ruleSourcePersonal"),
        desc: t("agentOrgs.ruleSourcePersonalDesc"),
      });
    }
    return options;
  }, [state.source, t]);

  return (
    <>
      <SectionContainer>
        <SectionRow
          label={t("agentOrgs.ruleSource")}
          description={t("agentOrgs.ruleSourceDesc")}
          required
        >
          <Select
            value={state.source}
            onChange={(val) => {
              const next = val as PolicySource;
              if (next === "workspace") {
                onChange({
                  ...state,
                  source: next,
                  repoId: state.repoId ?? repoOptions[0]?.value ?? null,
                  scopeMode: "all",
                  scopeRepoIds: [],
                  agentIds: [],
                });
              } else {
                onChange({
                  ...state,
                  source: next,
                  repoId: null,
                  scopeMode: "all",
                  scopeRepoIds: [],
                });
              }
            }}
            options={sourceOptions.map((opt) => ({
              label: opt.label,
              value: opt.value,
              title: opt.desc,
            }))}
            disabled={isEditing}
            size="default"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        {state.source === "global" && (
          <SectionRow
            label={t("agentOrgs.applicableAgents")}
            description={t("agentOrgs.applicableAgentsDesc")}
          >
            <Select
              mode="multiple"
              value={state.agentIds}
              onChange={(val) =>
                onChange({ ...state, agentIds: val as string[] })
              }
              options={agentOptions}
              placeholder={t("agentOrgs.selectAgents")}
              showSearch
              maxTagCount={MULTI_SELECT_TOKENS.maxTagCount}
              size="default"
              style={SECTION_CONTROL_STYLE}
              dropdownMinWidth={MULTI_SELECT_PANEL_WIDTH}
            />
          </SectionRow>
        )}
        {state.source === "workspace" && (
          <SectionRow
            label={t("agentOrgs.ruleRepo")}
            description={t("agentOrgs.ruleRepoDesc")}
            required
          >
            <Select
              value={state.repoId ?? undefined}
              onChange={(val) =>
                onChange({
                  ...state,
                  repoId: val as string,
                  scopeMode: "all",
                  scopeRepoIds: [],
                })
              }
              options={repoOptions}
              placeholder={t("agentOrgs.selectRepo")}
              showSearch
              disabled={isEditing}
              size="default"
              style={SECTION_CONTROL_STYLE}
            />
          </SectionRow>
        )}
      </SectionContainer>

      <SectionContainer>
        <SectionRow
          label={t("agentOrgs.ruleName")}
          description={t("agentOrgs.ruleNameDesc")}
          required
        >
          <Input
            value={state.name}
            onChange={(val) => onChange({ ...state, name: val })}
            placeholder={t("agentOrgs.markdownRuleNamePlaceholder")}
            size="default"
            style={SECTION_CONTROL_STYLE}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </SectionRow>
        <div className="flex flex-col gap-2 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-semibold text-text-1">
                {t("agentOrgs.markdownContent")}
                <span className="ml-0.5 text-danger-6">*</span>
              </div>
              <div className="mt-0.5 text-[12px] text-text-3">
                {t("agentOrgs.markdownContentDesc")}
              </div>
            </div>
            <TabPill
              tabs={editorTabs}
              activeTab={state.editorTab}
              onChange={(tab) => onChange({ ...state, editorTab: tab })}
              variant="pill"
              fillWidth={false}
            />
          </div>
          <MarkdownEditor
            value={state.content}
            onChange={(val) => onChange({ ...state, content: val })}
            minHeight={300}
            hideHeader
            activeTab={state.editorTab}
            onTabChange={(tab) => onChange({ ...state, editorTab: tab })}
          />
        </div>
      </SectionContainer>
    </>
  );
};

export default MarkdownRuleForm;
