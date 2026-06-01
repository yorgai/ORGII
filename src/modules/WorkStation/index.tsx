/**
 * WorkStationPage - Main page for Workstation
 *
 * Renders AppShell which handles:
 * - SimulatorFrame wrapper with panel controls
 * - Repository path validation
 * - App mode switching (CodeEditor/Browser/DatabaseManager)
 *
 * ChatPanel is rendered by AppLayout for both layout methods (inset/full).
 * The isFullMode prop only controls SimulatorFrame corner rounding.
 */
import React from "react";

import AppShell from "./AppShell";

export interface WorkStationPageProps {
  /** Whether WorkStation is currently visible (code view mode is active) */
  isActive?: boolean;
  /** Whether the chat panel is taking over the WorkStation surface */
  chatPanelFocused?: boolean;
  /** Whether using full layout mode (controls SimulatorFrame corner rounding) */
  isFullMode?: boolean;
}

const WorkStationPage: React.FC<WorkStationPageProps> = ({
  isActive = true,
  chatPanelFocused = false,
  isFullMode = false,
}) => {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <AppShell
        isActive={isActive}
        chatPanelFocused={chatPanelFocused}
        isFullMode={isFullMode}
      />
    </div>
  );
};

export default WorkStationPage;
