/**
 * usePanelTitle Hook
 *
 * Derives the panel title from the current session.
 * Returns session name, task name, or default title.
 *
 * Uses `sessionByIdAtom(id)` for fine-grained subscription — only
 * re-renders when the specific session changes, not the full list.
 */
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SESSION_CONFIG } from "@src/config/sessionCreatorConfig";
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms";
import {
  type Session,
  sessionByIdAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import { stripPillReferences } from "@src/util/session/stripPillReferences";

export interface UsePanelTitleResult {
  /** Current session ID (null if no session) */
  currentSessionId: string | null;
  /** Derived panel title */
  panelTitle: string;
  /** Current session object (if found) */
  currentSession: Session | null;
}

/**
 * Hook to get the current panel title based on active session
 */
export function usePanelTitle(): UsePanelTitleResult {
  const { t } = useTranslation("sessions");

  const coreSessionId = useAtomValue(sessionIdAtom);
  // The docked ChatPanel header reflects WorkStation's selection,
  // not the live pipeline — secondary surfaces that temporarily
  // claim the pipeline shouldn't change the panel title.
  const workstationSessionId = useAtomValue(workstationActiveSessionIdAtom);

  const currentSessionId = workstationSessionId || coreSessionId || null;

  const currentSession =
    (useAtomValue(sessionByIdAtom(currentSessionId ?? "")) as
      | Session
      | undefined) ?? null;

  const defaultTitle = t("chat.defaultTitle");

  const panelTitle = useMemo(() => {
    if (!currentSessionId) return t("chat.newSession");
    if (!currentSession) return defaultTitle;

    const effectiveName =
      currentSession.name &&
      currentSession.name !== SESSION_CONFIG.DEFAULT_SESSION_NAME
        ? currentSession.name
        : undefined;
    return (
      effectiveName ||
      stripPillReferences(currentSession.user_input || "") ||
      defaultTitle
    );
  }, [currentSessionId, currentSession, defaultTitle, t]);

  return {
    currentSessionId,
    panelTitle,
    currentSession,
  };
}
