import React from "react";
import { useTranslation } from "react-i18next";

import { DETAIL_PANEL_TOKENS } from "@src/modules/shared/layouts/blocks";

import { type UseAgentConfig } from "../mcp/AgentMcpSection";
import AgentMcpSection from "../mcp/AgentMcpSection";
import WorkspaceSettingsToggle from "../shared/WorkspaceSettingsToggle";
import AgentSkillsSection from "./AgentSkillsSection";

interface AgentSkillsetsSectionProps {
  headerElement?: React.ReactNode;
  agentId?: string;
  workspacePath?: string;
  useConfig: () => UseAgentConfig;
}

const AgentSkillsetsSection: React.FC<AgentSkillsetsSectionProps> = ({
  headerElement,
  agentId,
  workspacePath,
  useConfig,
}) => {
  const { t } = useTranslation("integrations");
  const { config, update } = useConfig();

  return (
    <>
      {headerElement}
      <div className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        <div
          className={`${DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop} flex flex-col gap-4`}
        >
          <WorkspaceSettingsToggle
            config={config}
            update={update}
            configKey="loadWorkspaceResources"
            labelKey="workspaceResources.loadWorkspaceResources"
            descriptionKey="workspaceResources.loadWorkspaceResourcesDesc"
            dataTestId="agent-orgs-load-workspace-resources-switch"
          />
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-1">
              {t("externalSkillsets.tabs.skills")}
            </h3>
            <AgentSkillsSection
              embedded
              agentId={agentId}
              workspacePath={workspacePath}
            />
          </section>
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-1">
              {t("externalSkillsets.tabs.mcp")}
            </h3>
            <AgentMcpSection embedded useConfig={useConfig} />
          </section>
        </div>
      </div>
    </>
  );
};

export default AgentSkillsetsSection;
