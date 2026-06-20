import { useAtomValue } from "jotai";
import React, { memo, useMemo } from "react";

import { todosAtom } from "@src/store/ui/todoAtom";

import PlanTodoPinBar from "./PlanTodoPinBar";

/**
 * Single source of truth for "does this session have any pinned content?".
 *
 * Call this ONCE at the top of the chat tree (in `ChatHistory`) and thread
 * the result down. Agent Team tasks intentionally stay on the overview panel,
 * which is already hydrated by `agent_org_session_run_view`; adding them here
 * would create a second 2.5s polling source for the same task board.
 */
export function usePinnedContent() {
  const todos = useAtomValue(todosAtom);
  return useMemo(
    () => ({
      hasPinnedContent: todos.length > 0,
    }),
    [todos.length]
  );
}

const ChatPinnedBars: React.FC = memo(() => {
  return (
    <div data-testid="chat-pinned-bars" className="relative z-20 w-full">
      <PlanTodoPinBar />
    </div>
  );
});

ChatPinnedBars.displayName = "ChatPinnedBars";

export default ChatPinnedBars;
