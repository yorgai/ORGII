import { useCallback } from "react";
import type { NavigateFunction } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import type { GoToNewSessionOptions } from "@src/hooks/navigation/useAppNavigation";
import {
  CHAT_PANEL_CREATE_TARGET,
  CHAT_PANEL_SURFACE_KIND,
  type ChatPanelCreateTarget,
  type ChatPanelNavigateCommand,
} from "@src/store/ui/chatPanelAtom";

interface UseSessionEntryActionsParams {
  goToNewSession: (options?: GoToNewSessionOptions) => void;
  navigate: NavigateFunction;
  navigateChatPanel: (command: ChatPanelNavigateCommand) => void;
  pathname: string;
  resetOpsControlStateForProjectsContent: () => void;
  setChatPanelCreateTarget: (target: ChatPanelCreateTarget) => void;
}

interface UseSessionEntryActionsResult {
  handleGoToNewSession: (options?: GoToNewSessionOptions) => void;
  handleOpenStickyNotes: () => void;
}

export function useSessionEntryActions({
  goToNewSession,
  navigate,
  navigateChatPanel,
  pathname,
  resetOpsControlStateForProjectsContent,
  setChatPanelCreateTarget,
}: UseSessionEntryActionsParams): UseSessionEntryActionsResult {
  const handleGoToNewSession = useCallback(
    (options?: GoToNewSessionOptions) => {
      navigateChatPanel({ kind: CHAT_PANEL_SURFACE_KIND.SESSION });
      setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
      goToNewSession(options);
    },
    [goToNewSession, navigateChatPanel, setChatPanelCreateTarget]
  );

  const handleOpenStickyNotes = useCallback(() => {
    resetOpsControlStateForProjectsContent();
    navigateChatPanel({ kind: CHAT_PANEL_SURFACE_KIND.STICKY_NOTES });
    setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
    const targetRoute = ROUTES.workStation.code.path;
    if (pathname !== targetRoute) navigate(targetRoute);
  }, [
    navigate,
    navigateChatPanel,
    pathname,
    resetOpsControlStateForProjectsContent,
    setChatPanelCreateTarget,
  ]);

  return { handleGoToNewSession, handleOpenStickyNotes };
}
