import { GalleryThumbnails } from "lucide-react";
import React from "react";

import Button from "@src/components/Button";
import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip from "@src/components/Tooltip";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { BenchmarkPanel } from "@src/features/BenchmarkPanel";
import type {
  ChatHistoryDisplayMode,
  ChatPanelSelectedCollabOrg,
  ChatPanelSelectedProject,
  ChatPanelSelectedProjectOrg,
  ChatPanelSelectedWorkItem,
  ChatPanelSelectedWorkspace,
} from "@src/store/ui/chatPanelAtom";

import ChatView from "./ChatView";
import CollabOrgPanelView from "./panels/CollabOrgPanelView";
import ProjectOrgPanelView from "./panels/ProjectOrgPanelView";
import ProjectPanelView from "./panels/ProjectPanelView";
import WorkItemPanelView from "./panels/WorkItemPanelView";
import WorkspaceDashboardPanelView from "./panels/WorkspaceDashboardPanelView";
import WorkspaceExplorePanelView from "./panels/WorkspaceExplorePanelView";
import WorkspaceOverviewPanelView from "./panels/WorkspaceOverviewPanelView";

interface ChatPanelContentProps {
  chatFocusLabel: string;
  currentSessionId: string | null;
  emptyChatContent: React.ReactNode;
  handleChatFocusToggle: () => void;
  handleRegisterSearchOpen: (handler: (() => void) | null) => void;
  displayMode: ChatHistoryDisplayMode;
  paginationEnabled: boolean;
  position: "left" | "right";
  selectedCollabOrg: ChatPanelSelectedCollabOrg | null;
  selectedProject: ChatPanelSelectedProject | null;
  selectedProjectOrg: ChatPanelSelectedProjectOrg | null;
  selectedWorkItem: ChatPanelSelectedWorkItem | null;
  selectedWorkspace: ChatPanelSelectedWorkspace | null;
  showBenchmarkSessionGroupContent: boolean;
  showCollabOrgContent: boolean;
  showEmptyChatFocusRestoreButton: boolean;
  showExploreContent: boolean;
  showPanelContent: boolean;
  showProjectContent: boolean;
  showProjectOrgContent: boolean;
  showSessionContent: boolean;
  showWorkItemContent: boolean;
  showWorkspaceDashboardContent: boolean;
  showWorkspaceOverviewContent: boolean;
}

export function ChatPanelContent({
  chatFocusLabel,
  currentSessionId,
  emptyChatContent,
  handleChatFocusToggle,
  handleRegisterSearchOpen,
  displayMode,
  paginationEnabled,
  position,
  selectedCollabOrg,
  selectedProject,
  selectedProjectOrg,
  selectedWorkItem,
  selectedWorkspace,
  showBenchmarkSessionGroupContent,
  showCollabOrgContent,
  showEmptyChatFocusRestoreButton,
  showExploreContent,
  showPanelContent,
  showProjectContent,
  showProjectOrgContent,
  showSessionContent,
  showWorkItemContent,
  showWorkspaceDashboardContent,
  showWorkspaceOverviewContent,
}: ChatPanelContentProps): React.ReactNode {
  const chatFocusTooltip = (
    <KeyboardShortcutTooltipContent
      label={chatFocusLabel}
      shortcut={getShortcutKeys("maximize_chat")}
    />
  );

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {!showPanelContent ? null : showBenchmarkSessionGroupContent ? (
        <BenchmarkPanel surface="runList" />
      ) : showWorkItemContent && selectedWorkItem ? (
        <WorkItemPanelView selectedWorkItem={selectedWorkItem} />
      ) : showProjectContent && selectedProject ? (
        <ProjectPanelView selectedProject={selectedProject} />
      ) : showProjectOrgContent && selectedProjectOrg ? (
        <ProjectOrgPanelView selectedProjectOrg={selectedProjectOrg} />
      ) : showWorkspaceDashboardContent ? (
        <WorkspaceDashboardPanelView />
      ) : showExploreContent ? (
        <WorkspaceExplorePanelView />
      ) : showCollabOrgContent && selectedCollabOrg ? (
        <CollabOrgPanelView selectedCollabOrg={selectedCollabOrg} />
      ) : showWorkspaceOverviewContent && selectedWorkspace ? (
        <WorkspaceOverviewPanelView selectedWorkspace={selectedWorkspace} />
      ) : showSessionContent && currentSessionId ? (
        <ChatView
          sessionId={currentSessionId}
          onRegisterSearchOpen={handleRegisterSearchOpen}
          displayMode={displayMode}
          turnPaginationEnabled={paginationEnabled}
          position={position}
        />
      ) : (
        emptyChatContent
      )}
      {showEmptyChatFocusRestoreButton && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 z-10 flex justify-center px-4">
          <Tooltip
            content={chatFocusTooltip}
            position="top"
            mouseEnterDelay={200}
            framedPanel
          >
            <span className="pointer-events-auto inline-flex">
              <Button
                htmlType="button"
                variant="secondary"
                appearance="outline"
                size="default"
                shape="round"
                onClick={handleChatFocusToggle}
                aria-label={chatFocusLabel}
                icon={<GalleryThumbnails size={15} strokeWidth={2} />}
              >
                {chatFocusLabel}
              </Button>
            </span>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
