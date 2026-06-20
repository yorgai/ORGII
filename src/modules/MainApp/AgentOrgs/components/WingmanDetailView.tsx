/**
 * WingmanDetailView — Agent Team detail panel for the built-in Wingman
 * agent.
 *
 * Wingman is a singleton, screen-observation agent. Its config surface
 * is the same as a custom agent (Personality / Models / Subagents /
 * Tools / MCP / Skills) PLUS a Wingman-specific Desktop Safety tab for
 * desktop operation visibility and safety gates. Security settings live in General.
 *
 * Implementation: thin wrapper around `CustomAgentDetailView` that
 * supplies the two extra tabs via the `extraTabs` prop. This keeps a
 * single source of truth for tabbed agent editors and stops Wingman
 * from drifting back into a "shrunken Overview" placeholder.
 */
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import DesktopSafetySection from "../config/DesktopSafetySection";
import type { AgentDefinition } from "../types";
import CustomAgentDetailView, {
  type CustomAgentExtraTab,
} from "./CustomAgentDetailView";

interface WingmanDetailViewProps {
  agent: AgentDefinition;
}

const WingmanDetailView: React.FC<WingmanDetailViewProps> = ({ agent }) => {
  const { t: tSettings } = useTranslation("settings");

  const extraTabs = useMemo<CustomAgentExtraTab[]>(
    () => [
      {
        key: "safety",
        label: tSettings("osAgent.desktopConfig.title"),
        content: <DesktopSafetySection />,
      },
    ],
    [tSettings]
  );

  // Wingman is built-in / non-deletable — header hides actions because `agent.builtIn === true`.
  const noop = useCallback(() => undefined, []);

  return (
    <CustomAgentDetailView
      agent={agent}
      onAgentDelete={noop}
      extraTabs={extraTabs}
      hideIdentityTitle
    />
  );
};

export default WingmanDetailView;
