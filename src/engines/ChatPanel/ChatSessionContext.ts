import { createContext, useContext } from "react";

/**
 * Provides the active session ID to descendant chat blocks.
 * Used by useEventBlockHeader to scope "collapse all" per session.
 */
export const ChatSessionContext = createContext<string | undefined>(undefined);

export function useChatSessionId(): string | undefined {
  return useContext(ChatSessionContext);
}
