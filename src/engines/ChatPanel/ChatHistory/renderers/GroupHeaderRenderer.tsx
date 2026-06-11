import { useAtomValue } from "jotai";
import React, { memo, useCallback, useState } from "react";

import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import { CHAT_ITEM_PADDING_X } from "@src/engines/ChatPanel/blocks/primitives/config";
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms";
import { loadSessionTurnBodyIntoStore } from "@src/engines/SessionCore/turns";

import UserChatItem from "../../ChatItems/UserChatItem";
import ChatPinnedBars from "../../InputArea/components/ChatPinnedBars";
import TurnCollapsePinBar from "../../InputArea/components/TurnCollapsePinBar";
import type { OptimizedChatItem } from "../chatItemPipeline/types";
import {
  type ChatGroupMeta,
  isTurnCollapseEligible,
} from "../hooks/useChatGroups";

export interface GroupHeaderRendererProps {
  groupIndex: number;
  sourceGroupIndex?: number;
  sourceGroupCount?: number;
  groupHeaders: (OptimizedChatItem | null)[];
  /** Per-group metadata aligned with `groupHeaders`. */
  groupMeta: ChatGroupMeta[];
  groupCount: number;
  /** Whether any pinned todo content exists for the current session. */
  hasPinnedContent: boolean;
  collapseLabelVariant?: "agent" | "agents";
  /** Hide the turn time range when another surface already shows it. */
  hideCollapseTimeRange?: boolean;
  /** Allows the latest turn to show the collapse bar after the session idles. */
  collapseTailWhenIdle?: boolean;
  /**
   * Skip rendering the per-turn user-message card (`UserChatItem` + its
   * attached `ChatPinnedBars`). The `TurnCollapsePinBar` ("Agent worked
   * for X") still renders. Subagent cells use this so each turn's
   * Coordinator prompt is hidden by default, surfaced via a toggle in
   * the pagination row.
   */
  hideUserMessage?: boolean;
  turnCollapseInteractionAtRef: React.MutableRefObject<number>;
  onEditSubmit?: (
    header: OptimizedChatItem,
    newText: string,
    imageDataUrls?: string[]
  ) => Promise<void> | void;
}

/**
 * Renders the sticky user-message group header row for GroupedVirtuoso.
 *
 * Wrapped in `memo` so it doesn't re-render every time the chat panel
 * tree re-mounts during scroll / event ticks. The header is one of N
 * sticky rows in the viewport, so even tiny wasted renders compound.
 */
export const GroupHeaderRenderer: React.FC<GroupHeaderRendererProps> = memo(
  ({
    groupIndex,
    sourceGroupIndex,
    sourceGroupCount,
    groupHeaders,
    groupMeta,
    groupCount,
    hasPinnedContent,
    collapseLabelVariant = "agent",
    hideCollapseTimeRange = false,
    collapseTailWhenIdle = false,
    hideUserMessage = false,
    turnCollapseInteractionAtRef,
    onEditSubmit,
  }) => {
    const header = groupHeaders[groupIndex];
    const meta = groupMeta[groupIndex];
    const collapseGroupIndex = sourceGroupIndex ?? groupIndex;
    const collapseGroupCount = sourceGroupCount ?? groupCount;
    const sessionId = useAtomValue(sessionIdAtom);
    const [isEditing, setIsEditing] = useState(false);

    // Stabilize the per-message handlers so memoized children
    // (`UserChatItem`, `TurnCollapsePinBar`) can skip identical-prop
    // re-renders. The original inline closures were rebuilt on every
    // render, defeating `TurnCollapsePinBar`'s `memo` wrap downstream.
    //
    // Both handlers preserve the original `undefined` semantics — they
    // return `undefined` instead of being declared as `undefined` props,
    // which keeps the prop reference stable across renders. Downstream
    // call sites that gate on truthiness (`if (onExpand)`) still work
    // because the stable closures themselves are always defined; the
    // bodies short-circuit when the inputs are missing.
    const turnId = meta?.turnId ?? null;
    const unloadedTurnId = meta?.unloadedTurn?.turnId ?? null;
    const canExpandUnloadedTurn = Boolean(sessionId && unloadedTurnId);
    const handleExpandUnloadedTurn = useCallback(async () => {
      if (!sessionId || !unloadedTurnId) return;
      await loadSessionTurnBodyIntoStore({
        sessionId,
        turnId: unloadedTurnId,
      });
    }, [sessionId, unloadedTurnId]);
    const handleEdit = useCallback(
      (newText: string, imageDataUrls?: string[]) => {
        if (!onEditSubmit || !header) return;
        return onEditSubmit(header, newText, imageDataUrls);
      },
      [onEditSubmit, header]
    );

    if (!header) return <div />;

    const isLastGroup = collapseGroupIndex === collapseGroupCount - 1;
    // Hide the attached pinned bar while the user is editing this message
    // so the editor doesn't carry an unrelated todo strip below it.
    const showPinnedBars = isLastGroup && hasPinnedContent && !isEditing;
    // Show the "Agent worked for …" pin bar on collapse-eligible turns.
    // The latest turn joins after the session has idled long enough.
    const showCollapseBar = isTurnCollapseEligible(
      meta,
      collapseGroupIndex,
      collapseGroupCount,
      {
        collapseTailWhenIdle,
      }
    );

    const headerPaddingBottomClass = showCollapseBar && turnId ? "" : "pb-2";

    return (
      <div
        className={`${CHAT_ITEM_PADDING_X} ${DETAIL_PANEL_TOKENS.contentWidth} ${headerPaddingBottomClass}`.trim()}
      >
        {/*
          User message and any pinned bars sit directly on the chat
          surface — the user message owns its own bordered card, the
          pinned strip flows underneath. No outer tinted wrapper: it
          added a second translucent layer once page transparency
          landed, which read as visual noise.
        */}
        {!hideUserMessage && (
          <>
            <UserChatItem
              chatItem={header}
              onEditSubmit={onEditSubmit ? handleEdit : undefined}
              onEditingChange={
                isLastGroup && hasPinnedContent ? setIsEditing : undefined
              }
            />
            {showPinnedBars && <ChatPinnedBars />}
          </>
        )}
        {showCollapseBar && turnId && (
          <TurnCollapsePinBar
            turnId={turnId}
            durationMs={meta?.durationMs ?? 0}
            startMs={meta?.startMs ?? null}
            endMs={meta?.endMs ?? null}
            showTimeRange={!hideCollapseTimeRange}
            labelVariant={collapseLabelVariant}
            defaultCollapsed
            turnCollapseInteractionAtRef={turnCollapseInteractionAtRef}
            onExpand={
              canExpandUnloadedTurn ? handleExpandUnloadedTurn : undefined
            }
          />
        )}
      </div>
    );
  }
);

GroupHeaderRenderer.displayName = "GroupHeaderRenderer";
