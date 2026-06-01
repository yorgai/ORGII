/**
 * ToolsCategoryView — renders the content pane for tools-related integrations
 * categories: built-in tools (category="tools") or Computer Use.
 */
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import TabPill from "@src/components/TabPill";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  InternalHeader,
} from "@src/modules/shared/layouts/blocks";

import ComputerUseConfig from "./BuiltInTools/Preview/DesktopToolConfig";
import { BuiltInToolsTable } from "./BuiltInTools/Table/BuiltInToolsTable";
import { useAgentToolMatrix } from "./BuiltInTools/useAgentToolMatrix";
import type { UseBuiltInToolsReturn } from "./BuiltInTools/useBuiltInTools";
import { ToolEventPreview } from "./DevTools/ToolEventPreview";
import type { IntegrationCategory } from "./types";

export interface ToolsCategoryViewProps {
  tools: UseBuiltInToolsReturn;
  category: IntegrationCategory;
}

export const ToolsCategoryView: React.FC<ToolsCategoryViewProps> = ({
  tools,
  category,
}) => {
  const { t } = useTranslation("integrations");
  type BuiltinTab = "table" | "playground";
  const [builtinTab, setBuiltinTab] = useState<BuiltinTab>("table");

  const agentMatrix = useAgentToolMatrix();

  const builtinTabs = useMemo(
    () => [
      { key: "table", label: t("builtInTools.tabTools") },
      { key: "playground", label: t("toolsArea.devtools") },
    ],
    [t]
  );

  const computerUseTabs = useMemo(
    () => [{ key: "desktop", label: t("builtInTools.tabDesktopControl") }],
    [t]
  );

  // ── Built-in tools view (list + playground) ──────────────────────────────
  if (category === "tools") {
    const builtinHeader = (
      <InternalHeader
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
        tabs={
          <TabPill
            tabs={builtinTabs}
            activeTab={builtinTab}
            onChange={(key) => setBuiltinTab(key as BuiltinTab)}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        }
      />
    );

    if (builtinTab === "playground") {
      return (
        <DetailPanelContainer>
          {builtinHeader}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            <div
              className={`${DETAIL_PANEL_TOKENS.contentWidth} flex min-h-0 flex-1 flex-col`}
            >
              <ToolEventPreview />
            </div>
          </div>
        </DetailPanelContainer>
      );
    }

    return (
      <DetailPanelContainer>
        {builtinHeader}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <BuiltInToolsTable tools={tools} agentMatrix={agentMatrix} />
        </div>
      </DetailPanelContainer>
    );
  }

  // ── Computer Use (standalone sidebar tab) ────────────────────────────────
  if (category === "computerUse") {
    return (
      <DetailPanelContainer>
        <InternalHeader
          noPanelHeader
          contentPadding
          className={DETAIL_PANEL_TOKENS.headerWidth}
          tabs={
            <TabPill
              tabs={computerUseTabs}
              activeTab="desktop"
              onChange={() => {}}
              variant="simple"
              fillWidth={false}
              size="large"
            />
          }
        />
        <div className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
          <div
            className={`${DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop} flex flex-col gap-3`}
          >
            <ComputerUseConfig />
          </div>
        </div>
      </DetailPanelContainer>
    );
  }

  return null;
};
