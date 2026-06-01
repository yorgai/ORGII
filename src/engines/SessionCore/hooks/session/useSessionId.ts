/**
 * useSessionId Hook
 *
 * Resolves the active session ID for chat-pipeline consumers.
 * Priority: prop → ChatSessionContext override → activeSessionIdAtom.
 *
 * The ChatSessionContext override exists so that ChatHistory instances
 * rendered inside subagent grid cells (and other detached chat surfaces)
 * scope reply/skip/edit actions to *their* session, not the globally
 * active one. Without this, clicking Reply inside a subagent strip cell
 * would post to the parent session — see the subagent bottom strip
 * design notes.
 *
 * NOTE: Surfaces that need WorkStation's *remembered* session (e.g.
 * sidebar highlight, panel title, todo/plan scoping) should read
 * `workstationActiveSessionIdAtom` directly instead of this hook.
 */
import { useAtomValue } from "jotai";
import { useMemo } from "react";

import { useChatSessionId } from "@src/engines/ChatPanel/ChatSessionContext";
import { activeSessionIdAtom } from "@src/store/session";

export interface UseSessionIdOptions {
  /** Explicit sessionId from props (highest priority) */
  propSessionId?: string;
}

export interface UseSessionIdResult {
  /** The resolved sessionId (may be undefined if not found) */
  sessionId: string | undefined;
  /** Source of the sessionId */
  source: "prop" | "chatContext" | "activeAtom" | "none";
}

export function useSessionId(
  options: UseSessionIdOptions = {}
): UseSessionIdResult {
  const { propSessionId } = options;

  const chatContextSessionId = useChatSessionId();
  const activeSessionId = useAtomValue(activeSessionIdAtom);

  return useMemo(() => {
    if (propSessionId) {
      return { sessionId: propSessionId, source: "prop" as const };
    }

    if (chatContextSessionId) {
      return {
        sessionId: chatContextSessionId,
        source: "chatContext" as const,
      };
    }

    if (activeSessionId) {
      return { sessionId: activeSessionId, source: "activeAtom" as const };
    }

    return { sessionId: undefined, source: "none" as const };
  }, [propSessionId, chatContextSessionId, activeSessionId]);
}
