import { useAtom, useAtomValue } from "jotai";
import React, { useCallback, useMemo } from "react";

import type { RustAgentType } from "@src/api/tauri/agent/types";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
} from "@src/modules/shared/layouts/blocks";
import { currentRepoAtom } from "@src/store/repo";
import {
  BUILTIN_OS_DEF_ID,
  BUILTIN_SDE_DEF_ID,
} from "@src/util/session/sessionDispatch";

import AgentBuiltinConfigSection, {
  useOSAgentTabs,
  useSdeAgentTabs,
} from "../config/AgentBuiltinConfigSection";
import { isFullHeightAgentTab } from "../config/agentDetailTabs";
import CustomAgentToolsSection from "../config/customAgent/CustomAgentToolsSection";
import { useOSAgentConfig } from "../config/osAgent/useOSAgentConfig";
import { useSdeAgentConfig } from "../config/sdeAgent/useSdeAgentConfig";
import AgentSkillsetsSection from "../config/skills/AgentSkillsetsSection";
import { agentOrgsActiveTabAtom } from "../store/agentOrgsActiveTabAtom";
import AgentDetailHeader from "./AgentDetailHeader";

interface BuiltInAgentDetailViewProps {
  variant: RustAgentType;
}

export const BuiltInAgentDetailView: React.FC<BuiltInAgentDetailViewProps> = ({
  variant,
}) => {
  const osTabs = useOSAgentTabs();
  const sdeTabs = useSdeAgentTabs();
  const tabs = variant === "os" ? osTabs : sdeTabs;
  const [activeTab, setActiveTab] = useAtom(agentOrgsActiveTabAtom);
  const currentRepo = useAtomValue(currentRepoAtom);
  const workspacePath = variant === "sde" ? currentRepo?.path : undefined;

  const agentId = variant === "os" ? BUILTIN_OS_DEF_ID : BUILTIN_SDE_DEF_ID;
  const osConfig = useOSAgentConfig();
  const sdeConfig = useSdeAgentConfig(
    variant === "sde" ? workspacePath : undefined
  );
  const useOSConfigForMcp = useCallback(() => osConfig, [osConfig]);
  const useSdeConfigForMcp = useCallback(() => sdeConfig, [sdeConfig]);

  const isFullHeight = isFullHeightAgentTab(activeTab);

  const detailTestId =
    variant === "os"
      ? "agent-orgs-builtin-detail-os"
      : "agent-orgs-builtin-detail-sde";

  const headerElement = useMemo(
    () => (
      <AgentDetailHeader
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    ),
    [tabs, activeTab, setActiveTab]
  );
  const rootProps = useMemo(
    () =>
      ({
        "data-active-tab": activeTab,
      }) as React.HTMLAttributes<HTMLDivElement>,
    [activeTab]
  );

  if (isFullHeight && activeTab === "tools") {
    return (
      <DetailPanelContainer testId={detailTestId} rootProps={rootProps}>
        <CustomAgentToolsSection
          agentId={agentId}
          headerElement={headerElement}
        />
      </DetailPanelContainer>
    );
  }

  if (isFullHeight && activeTab === "skillsets") {
    return (
      <div
        className="flex h-full flex-col"
        data-active-tab={activeTab}
        data-testid={detailTestId}
      >
        <AgentSkillsetsSection
          headerElement={headerElement}
          agentId={agentId}
          workspacePath={workspacePath}
          useConfig={variant === "os" ? useOSConfigForMcp : useSdeConfigForMcp}
        />
      </div>
    );
  }

  return (
    <DetailPanelContainer testId={detailTestId} rootProps={rootProps}>
      {headerElement}
      <div className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        <div className={DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop}>
          <AgentBuiltinConfigSection
            kind={variant === "os" ? "os" : "sde"}
            workspacePath={workspacePath}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </div>
      </div>
    </DetailPanelContainer>
  );
};
