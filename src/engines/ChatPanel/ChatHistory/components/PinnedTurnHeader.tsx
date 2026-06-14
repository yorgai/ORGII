import React, { memo, useCallback, useState } from "react";

import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import { CHAT_ITEM_PADDING_X } from "@src/engines/ChatPanel/blocks/primitives/config";
import { loadSessionTurnBodyIntoStore } from "@src/engines/SessionCore/turns";

import UserChatItem from "../../ChatItems/UserChatItem";
import ChatPinnedBars from "../../InputArea/components/ChatPinnedBars";
import TurnCollapsePinBar from "../../InputArea/components/TurnCollapsePinBar";
import type { OptimizedChatItem } from "../chatItemPipeline/types";
import { CHAT_FOOTER_SPACER } from "../config/chatFooterSpacer";
import {
  type ChatGroupMeta,
  isTurnCollapseEligible,
} from "../hooks/useChatGroups";
import type { GroupHeaderRendererProps } from "../renderers/GroupHeaderRenderer";

interface PinnedTurnHeaderProps {
  visible: boolean;
  sessionId: string | null;
  sourceGroupIndex?: number;
  sourceGroupCount: number;
  header: OptimizedChatItem | null | undefined;
  meta: ChatGroupMeta | undefined;
  hasPinnedContent: boolean;
  collapseLabelVariant?: GroupHeaderRendererProps["collapseLabelVariant"];
  collapseTailWhenIdle: boolean;
  hideUserMessage: boolean;
  turnCollapseInteractionAtRef: React.MutableRefObject<number>;
  onEditSubmit: GroupHeaderRendererProps["onEditSubmit"];
}

function samePinnedHeader(
  left: OptimizedChatItem | null | undefined,
  right: OptimizedChatItem | null | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.chunk_id === right.chunk_id &&
    left.type === right.type &&
    left.event?.id === right.event?.id &&
    left.event?.displayText === right.event?.displayText &&
    left.event?.createdAt === right.event?.createdAt
  );
}

function samePinnedMeta(
  left: ChatGroupMeta | undefined,
  right: ChatGroupMeta | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.turnId === right.turnId &&
    left.durationMs === right.durationMs &&
    left.itemCount === right.itemCount &&
    left.previewText === right.previewText &&
    left.startMs === right.startMs &&
    left.endMs === right.endMs &&
    left.unloadedTurn?.turnId === right.unloadedTurn?.turnId
  );
}

function samePinnedTurnHeaderProps(
  previous: PinnedTurnHeaderProps,
  next: PinnedTurnHeaderProps
): boolean {
  return (
    previous.visible === next.visible &&
    previous.sessionId === next.sessionId &&
    previous.sourceGroupIndex === next.sourceGroupIndex &&
    previous.sourceGroupCount === next.sourceGroupCount &&
    previous.hasPinnedContent === next.hasPinnedContent &&
    previous.collapseLabelVariant === next.collapseLabelVariant &&
    previous.collapseTailWhenIdle === next.collapseTailWhenIdle &&
    previous.hideUserMessage === next.hideUserMessage &&
    previous.turnCollapseInteractionAtRef ===
      next.turnCollapseInteractionAtRef &&
    previous.onEditSubmit === next.onEditSubmit &&
    samePinnedHeader(previous.header, next.header) &&
    samePinnedMeta(previous.meta, next.meta)
  );
}

const PinnedTurnHeaderComponent: React.FC<PinnedTurnHeaderProps> = ({
  visible,
  sessionId,
  sourceGroupIndex,
  sourceGroupCount,
  header,
  meta,
  hasPinnedContent,
  collapseLabelVariant = "agent",
  collapseTailWhenIdle,
  hideUserMessage,
  turnCollapseInteractionAtRef,
  onEditSubmit,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const collapseGroupIndex = sourceGroupIndex ?? 0;
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

  if (!visible || !header) return null;

  const isLastGroup = collapseGroupIndex === sourceGroupCount - 1;
  const showPinnedBars = isLastGroup && hasPinnedContent && !isEditing;
  const showCollapseBar = isTurnCollapseEligible(
    meta,
    collapseGroupIndex,
    sourceGroupCount,
    {
      collapseTailWhenIdle,
    }
  );
  const headerPaddingBottomClass = showCollapseBar && turnId ? "" : "pb-2";
  const pinnedContentBodyGap = showPinnedBars
    ? CHAT_FOOTER_SPACER.PINNED_CONTENT_BODY_GAP_PX
    : 0;

  return (
    <div className="relative z-[70]">
      <div
        className={`${CHAT_ITEM_PADDING_X} ${DETAIL_PANEL_TOKENS.contentWidth} bg-chat-pane ${headerPaddingBottomClass}`.trim()}
      >
        {!hideUserMessage && (
          <div
            className={
              showPinnedBars
                ? "flex flex-col rounded-[12px] bg-chat-container"
                : "contents"
            }
            style={
              pinnedContentBodyGap > 0
                ? { marginBottom: pinnedContentBodyGap }
                : undefined
            }
          >
            <UserChatItem
              chatItem={header}
              onEditSubmit={onEditSubmit ? handleEdit : undefined}
              onEditingChange={
                isLastGroup && hasPinnedContent ? setIsEditing : undefined
              }
            />
            {showPinnedBars && <ChatPinnedBars />}
          </div>
        )}
        {showCollapseBar && turnId && (
          <TurnCollapsePinBar
            turnId={turnId}
            durationMs={meta?.durationMs ?? 0}
            startMs={meta?.startMs ?? null}
            endMs={meta?.endMs ?? null}
            showTimeRange={false}
            labelVariant={collapseLabelVariant}
            defaultCollapsed
            turnCollapseInteractionAtRef={turnCollapseInteractionAtRef}
            onExpand={
              canExpandUnloadedTurn ? handleExpandUnloadedTurn : undefined
            }
          />
        )}
      </div>
    </div>
  );
};

const PinnedTurnHeader = memo(
  PinnedTurnHeaderComponent,
  samePinnedTurnHeaderProps
);

PinnedTurnHeader.displayName = "PinnedTurnHeader";

export default PinnedTurnHeader;
