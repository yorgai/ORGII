import { useCallback } from "react";
import type { NavigateFunction } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import type { GoToNewSessionOptions } from "@src/hooks/navigation/useAppNavigation";
import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelContentMode,
  type ChatPanelCreateProjectContext,
  type ChatPanelCreateTarget,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedWorkItem,
  type ChatPanelSelectedWorkspace,
} from "@src/store/ui/chatPanelAtom";

type NullableSetter<T> = (value: T | null) => void;

interface UseSessionEntryActionsParams {
  goToNewSession: (options?: GoToNewSessionOptions) => void;
  navigate: NavigateFunction;
  pathname: string;
  resetOpsControlStateForProjectsContent: () => void;
  setChatPanelContentMode: (mode: ChatPanelContentMode) => void;
  setChatPanelCreateProjectContext: NullableSetter<ChatPanelCreateProjectContext>;
  setChatPanelCreateTarget: (target: ChatPanelCreateTarget) => void;
  setChatPanelSelectedProject: NullableSetter<ChatPanelSelectedProject>;
  setChatPanelSelectedWorkItem: NullableSetter<ChatPanelSelectedWorkItem>;
  setChatPanelSelectedWorkspace: NullableSetter<ChatPanelSelectedWorkspace>;
  setChatPanelStickyNotesOpen: (open: boolean) => void;
}

interface UseSessionEntryActionsResult {
  handleGoToNewSession: (options?: GoToNewSessionOptions) => void;
  handleOpenStickyNotes: () => void;
}

export function useSessionEntryActions({
  goToNewSession,
  navigate,
  pathname,
  resetOpsControlStateForProjectsContent,
  setChatPanelContentMode,
  setChatPanelCreateProjectContext,
  setChatPanelCreateTarget,
  setChatPanelSelectedProject,
  setChatPanelSelectedWorkItem,
  setChatPanelSelectedWorkspace,
  setChatPanelStickyNotesOpen,
}: UseSessionEntryActionsParams): UseSessionEntryActionsResult {
  const handleGoToNewSession = useCallback(
    (options?: GoToNewSessionOptions) => {
      setChatPanelSelectedWorkItem(null);
      setChatPanelSelectedProject(null);
      setChatPanelSelectedWorkspace(null);
      setChatPanelStickyNotesOpen(false);
      setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
      goToNewSession(options);
    },
    [
      goToNewSession,
      setChatPanelCreateTarget,
      setChatPanelSelectedProject,
      setChatPanelSelectedWorkspace,
      setChatPanelSelectedWorkItem,
      setChatPanelStickyNotesOpen,
    ]
  );

  const handleOpenStickyNotes = useCallback(() => {
    resetOpsControlStateForProjectsContent();
    setChatPanelSelectedWorkItem(null);
    setChatPanelSelectedProject(null);
    setChatPanelSelectedWorkspace(null);
    setChatPanelCreateProjectContext(null);
    setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
    setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
    setChatPanelStickyNotesOpen(true);
    const targetRoute = ROUTES.workStation.code.path;
    if (pathname !== targetRoute) navigate(targetRoute);
  }, [
    navigate,
    pathname,
    resetOpsControlStateForProjectsContent,
    setChatPanelContentMode,
    setChatPanelCreateProjectContext,
    setChatPanelCreateTarget,
    setChatPanelSelectedProject,
    setChatPanelSelectedWorkspace,
    setChatPanelSelectedWorkItem,
    setChatPanelStickyNotesOpen,
  ]);

  return { handleGoToNewSession, handleOpenStickyNotes };
}
