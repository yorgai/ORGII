/**
 * Memoized Chat Item Components
 *
 * Extracted from ChatItemRenderer for modularity.
 * Each component wraps a specific chat item type with memo + ChatItemWrap.
 *
 * NOTE: Agent messages are rendered via the activity event registry
 * (ActivityRouter → events/stream/agent-message), not through this file.
 * Per-turn actions (Regenerate, etc.) flow via AgentTurnContext.
 */
import { useAtom } from "jotai";
import { memo, useCallback, useRef } from "react";

import { useEventNavigation } from "@src/engines/SessionCore";
import { selectedExecutionThreadAtom } from "@src/store/ui/sessionPaginationAtom";

import UserChatItem from "../../ChatItems/UserChatItem";
import { stripExpandedPillContent } from "../../InputArea/utils/pillContentParser";
import ThreadSelector from "../../ThreadSelector";
import type { ExecutionThread } from "../../ThreadSelector/types";
import type { OptimizedChatItem } from "../chatItemPipeline/types";
import ChatItemWrap from "./ChatItemWrap";

// ============================================
// Types
// ============================================

// Extended OptimizedChatItem type for thread selector
// NOTE: selectedThreadId and onSelectThread are NOT in the data —
// MemoizedThreadSelector reads the atom directly (data/behavior separation).
export interface ThreadSelectorChatItem extends OptimizedChatItem {
  type: "threadSelector";
  threadSelectorData: {
    roundNumber: number;
    threads: ExecutionThread[];
    threadFirstEventMap: Map<string, string>;
  };
}

// ============================================
// Memoized Components
// ============================================

/** Memoized wrapper for ThreadSelector with navigation.
 *  Reads thread selection state directly from atom (data/behavior separation). */
export const MemoizedThreadSelector = memo(
  ({
    threads,
    threadFirstEventMap,
  }: {
    threads: ExecutionThread[];
    threadFirstEventMap: Map<string, string>;
  }) => {
    const [selectedThreadId, setSelectedThreadId] = useAtom(
      selectedExecutionThreadAtom
    );
    const { navigateToEvent } = useEventNavigation();
    const lastNavigatedThreadRef = useRef<string | null>(null);

    const handleNavigateToThread = useCallback(
      (threadId: string) => {
        const eventId = threadFirstEventMap.get(threadId);
        if (eventId && lastNavigatedThreadRef.current !== threadId) {
          lastNavigatedThreadRef.current = threadId;
          navigateToEvent(eventId);
        }
      },
      [threadFirstEventMap, navigateToEvent]
    );

    return (
      <ThreadSelector
        threads={threads}
        selectedThreadId={selectedThreadId}
        onSelectThread={setSelectedThreadId}
        onNavigateToThread={handleNavigateToThread}
        showAllOption={true}
      />
    );
  }
);
MemoizedThreadSelector.displayName = "MemoizedThreadSelector";

/** Memoized wrapper for UserChatItem */
export const MemoizedUserChatItem = memo(
  ({
    chatItem,
    index,
    onEditUserMessage,
  }: {
    chatItem: OptimizedChatItem;
    index: number;
    onEditUserMessage?: (
      chatItem: OptimizedChatItem,
      newText: string,
      imageDataUrls?: string[]
    ) => void;
  }) => {
    const event = chatItem.event;
    if (!event) return null;

    const text =
      typeof event.displayText === "string"
        ? stripExpandedPillContent(String(event.displayText)).trim()
        : "";
    if (!text) return null;

    const handleEditSubmit = onEditUserMessage
      ? (newText: string, imageDataUrls?: string[]) =>
          onEditUserMessage(chatItem, newText, imageDataUrls)
      : undefined;

    return (
      <ChatItemWrap
        className={`w-full${index > 0 ? "mt-4" : ""}`}
        dataAttr={{ "data-user-msg-idx": index }}
      >
        <UserChatItem chatItem={chatItem} onEditSubmit={handleEditSubmit} />
      </ChatItemWrap>
    );
  }
);
MemoizedUserChatItem.displayName = "MemoizedUserChatItem";
