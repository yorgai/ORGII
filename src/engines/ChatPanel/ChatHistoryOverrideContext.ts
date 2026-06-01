/**
 * ChatHistoryOverrideContext
 *
 * Lets a parent surface inject a pre-computed `SessionEvent[]` array that
 * `useChatHistory()` should return instead of the session-scoped atom
 * value. Used by the subagent grid cell to slice chat events to the
 * replay cursor's timestamp so the cell only renders events that have
 * already happened "up to that point of replay".
 *
 * Keeping this as a React context (not a Jotai atom) means each cell can
 * provide its own cursor without contaminating the shared atom family.
 * `undefined` means "no override — use the normal atom value".
 */
import { createContext, useContext } from "react";

import type { SessionEvent } from "@src/engines/SessionCore";

export const ChatHistoryOverrideContext = createContext<
  SessionEvent[] | undefined
>(undefined);

export function useChatHistoryOverride(): SessionEvent[] | undefined {
  return useContext(ChatHistoryOverrideContext);
}
