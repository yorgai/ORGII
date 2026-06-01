import React from "react";
import { useTranslation } from "react-i18next";

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
      <div className="scrollbar-overlay min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-4 px-4 pb-10 pt-4">
          <WorkspaceSettingsToggle config={config} update={update} />
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
