import { useCallback } from "react";

import type { GoToNewSessionOptions } from "@src/hooks/navigation/useAppNavigation";
import {
  CHAT_PANEL_CREATE_TARGET,
  CHAT_PANEL_SURFACE_KIND,
  type ChatPanelCreateTarget,
  type ChatPanelNavigateCommand,
} from "@src/store/ui/chatPanelAtom";

interface UseSessionEntryActionsParams {
  goToNewSession: (options?: GoToNewSessionOptions) => void;
  navigateChatPanel: (command: ChatPanelNavigateCommand) => void;
  setChatPanelCreateTarget: (target: ChatPanelCreateTarget) => void;
}

interface UseSessionEntryActionsResult {
  handleGoToNewSession: (options?: GoToNewSessionOptions) => void;
}

export function useSessionEntryActions({
  goToNewSession,
  navigateChatPanel,
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

  return { handleGoToNewSession };
}
