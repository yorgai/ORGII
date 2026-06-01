/**
 * AgentDetailHeader — standard tab bar header for agent detail views.
 *
 * Wraps `InternalHeader + TabPill` in the exact same shape used by every
 * agent detail view (BuiltIn OS/SDE, Custom, Wingman). Centralising this
 * removes three near-identical `headerElement` constructions across
 * BuiltInAgentDetailView and CustomAgentDetailView.
 */
import React, { memo } from "react";

import type { TabPillItem } from "@src/components/TabPill";
import TabPill from "@src/components/TabPill";
import {
  DETAIL_PANEL_TOKENS,
  InternalHeader,
} from "@src/modules/shared/layouts/blocks";

interface AgentDetailHeaderProps {
  tabs: TabPillItem[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  /** Optional right-side action buttons (e.g. delete button). */
  actions?: React.ReactNode;
}

const AgentDetailHeader: React.FC<AgentDetailHeaderProps> = memo(
  ({ tabs, activeTab, onTabChange, actions }) => (
    <InternalHeader
      noPanelHeader
      contentPadding
      className={DETAIL_PANEL_TOKENS.headerWidth}
      tabs={
        <TabPill
          tabs={tabs}
          activeTab={activeTab}
          onChange={onTabChange}
          variant="simple"
          fillWidth={false}
          size="large"
        />
      }
      actions={actions}
    />
  )
);

AgentDetailHeader.displayName = "AgentDetailHeader";

export default AgentDetailHeader;
