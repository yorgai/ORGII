import { GalleryThumbnails } from "lucide-react";
import React from "react";

import Button from "@src/components/Button";
import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip from "@src/components/Tooltip";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { BenchmarkPanel } from "@src/features/BenchmarkPanel";
import type {
  ChatPanelSelectedProject,
  ChatPanelSelectedWorkItem,
  ChatPanelSelectedWorkspace,
} from "@src/store/ui/chatPanelAtom";

import ChatView from "./ChatView";
import ProjectPanelView from "./ProjectPanelView";
import StickyNotesPanelView from "./StickyNotesPanelView";
import WorkItemPanelView from "./WorkItemPanelView";
import WorkspaceDashboardPanelView from "./WorkspaceDashboardPanelView";
import WorkspaceOverviewPanelView from "./WorkspaceOverviewPanelView";

interface ChatPanelContentProps {
  chatFocusLabel: string;
  currentSessionId: string | null;
  emptyChatContent: React.ReactNode;
  handleChatFocusToggle: () => void;
  handleRegisterSearchOpen: (handler: (() => void) | null) => void;
  paginationEnabled: boolean;
  position: "left" | "right";
  selectedProject: ChatPanelSelectedProject | null;
  selectedWorkItem: ChatPanelSelectedWorkItem | null;
  selectedWorkspace: ChatPanelSelectedWorkspace | null;
  showBenchmarkSessionGroupContent: boolean;
  showEmptyChatFocusRestoreButton: boolean;
  showPanelContent: boolean;
  showProjectContent: boolean;
  showSessionContent: boolean;
  showStickyNotesContent: boolean;
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
  paginationEnabled,
  position,
  selectedProject,
  selectedWorkItem,
  selectedWorkspace,
  showBenchmarkSessionGroupContent,
  showEmptyChatFocusRestoreButton,
  showPanelContent,
  showProjectContent,
  showSessionContent,
  showStickyNotesContent,
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
      ) : showWorkspaceDashboardContent ? (
        <WorkspaceDashboardPanelView />
      ) : showWorkspaceOverviewContent && selectedWorkspace ? (
        <WorkspaceOverviewPanelView selectedWorkspace={selectedWorkspace} />
      ) : showStickyNotesContent ? (
        <StickyNotesPanelView />
      ) : showSessionContent && currentSessionId ? (
        <ChatView
          sessionId={currentSessionId}
          onRegisterSearchOpen={handleRegisterSearchOpen}
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
