/**
 * EmptyState Component
 *
 * Placeholder shown when a message view has no entries yet.
 * Uses the shared simulator placeholder for visual consistency.
 */
import React from "react";

import {
  NoTabsPlaceholder,
  type SessionReplayPlaceholderMode,
  useSimulatorAwaitingAgentCaption,
  useSimulatorPlaceholderActions,
} from "@src/modules/WorkStation/shared";

import type { MessageViewMode } from "./types";

// ============================================
// EmptyState
// ============================================

export const EmptyState: React.FC<{
  viewMode: MessageViewMode;
  sessionReplayMode?: SessionReplayPlaceholderMode;
}> = ({ viewMode: _viewMode, sessionReplayMode = "simulation" }) => {
  const simulatorPlaceholderActions =
    useSimulatorPlaceholderActions(sessionReplayMode);
  const simulatorAwaitingAgentCaption = useSimulatorAwaitingAgentCaption();
  return (
    <NoTabsPlaceholder
      icon="chat"
      caption={simulatorAwaitingAgentCaption}
      actions={simulatorPlaceholderActions}
    />
  );
};
