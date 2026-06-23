import { createContext, useContext } from "react";

export const CHAT_SESSION_CONTEXT_NONE = "__orgii_chat_session_none__";

/**
 * Provides the active session ID to descendant chat blocks.
 * Used by useEventBlockHeader to scope "collapse all" per session.
 */
export const ChatSessionContext = createContext<string | undefined>(undefined);

export function useChatSessionId(): string | undefined {
  return useContext(ChatSessionContext);
}
