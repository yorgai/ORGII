import { MailOpen } from "lucide-react";
import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import {
  BlockOutput,
  EVENT_BLOCK_TRANSPARENT_EXPANDED_SHELL_CLASSES,
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderTitle,
  SESSION_UI_TOKENS,
  getEventBlockContainerClasses,
} from "@src/engines/ChatPanel/blocks/primitives";
import { useBlockHeader } from "@src/engines/ChatPanel/blocks/useBlockLocate";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  AgentTurnContext,
  type AgentTurnContextValue,
} from "../AgentTurnContext";
import { useGroupChatContext } from "../GroupChatView/GroupChatContext";
import GroupChatMessageBubble from "../GroupChatView/GroupChatMessageBubble";
import {
  extractGroupMessageContent,
  isAgentOrgInboxTranscriptEvent,
  resolveGroupChatMessageBubble,
  resolveGroupChatToolUseSummary,
} from "../GroupChatView/groupChatUtils";
import type { OptimizedChatItem } from "../chatItemPipeline/types";
import { NewEventDivider } from "../components/NewEventDivider";
import { getUnloadedTurnMeta } from "../hooks/useChatGroups";
import { ChatItemRenderer } from "./ChatItemRenderer";
import ChatItemWrap from "./ChatItemWrap";

const GROUP_CHAT_CONTINUATION_WINDOW_MS = 60_000;
const INBOX_TRANSCRIPT_ICON = (
  <MailOpen size={SESSION_UI_TOKENS.ICON.SIZE_SM} />
);

function isWithinGroupChatContinuationWindow(
  previousTimestamp: string,
  currentTimestamp: string
): boolean {
  const previousTime = Date.parse(previousTimestamp);
  const currentTime = Date.parse(currentTimestamp);
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
    return false;
  }
  const elapsedMs = currentTime - previousTime;
  return elapsedMs >= 0 && elapsedMs <= GROUP_CHAT_CONTINUATION_WINDOW_MS;
}

function getInboxTranscriptBody(event: SessionEvent): string {
  return extractGroupMessageContent(event).trim();
}

const InboxTranscriptCard: React.FC<{
  event: SessionEvent;
  title: string;
}> = ({ event, title }) => {
  const { t } = useTranslation("sessions");
  const body = getInboxTranscriptBody(event);
  const hasContent = body.length > 0;
  const {
    isCollapsed,
    isHeaderHovered,
    handleHeaderClick,
    handleHeaderMouseEnter,
    handleHeaderMouseLeave,
  } = useBlockHeader({ defaultCollapsed: true, eventId: event.id });

  return (
    <div className={`${getEventBlockContainerClasses(false)} animate-fade-in`}>
      <EventBlockHeader
        isCollapsed={isCollapsed}
        withHover={false}
        onClick={hasContent ? handleHeaderClick : undefined}
        onMouseEnter={handleHeaderMouseEnter}
        onMouseLeave={handleHeaderMouseLeave}
      >
        <EventBlockHeaderIcon
          icon={INBOX_TRANSCRIPT_ICON}
          isCollapsed={isCollapsed}
          isHeaderHovered={isHeaderHovered}
          iconSize={SESSION_UI_TOKENS.ICON.SIZE_SM}
          hasContent={hasContent}
        />
        <EventBlockHeaderTitle>{title}</EventBlockHeaderTitle>
      </EventBlockHeader>

      {!isCollapsed && hasContent && (
        <div
          className={`${EVENT_BLOCK_TRANSPARENT_EXPANDED_SHELL_CLASSES} animate-fade-in`}
        >
          <div className="border-b border-border-1 px-3 py-1.5 text-[13px] leading-normal">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-text-3">
                {t("cards.agentMessage.meta.sender")}
              </span>
              <span className="min-w-0 flex-1 truncate text-text-1">
                {t("cards.agentMessage.emailBubble.subagentMessages")}
              </span>
            </div>
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-text-3">
                {t("cards.agentMessage.meta.recipient")}
              </span>
              <span className="min-w-0 flex-1 truncate text-text-1">
                Coordinator
              </span>
            </div>
          </div>
          <BlockOutput
            output={body}
            withBorder={false}
            sessionId={event.sessionId}
            eventId={event.id}
          />
        </div>
      )}
    </div>
  );
};

export interface GroupItemRendererProps {
  flatIndex: number;
  groupIndex: number;
  flatItems: OptimizedChatItem[];
  /**
   * Per-group post-collapse item counts, aligned with `groupHeaders`.
   * Used to detect "last item in this group" so we can append a turn
   * gap below the trailing item — placing the gap on the previous
   * group keeps the next group's sticky header free of `pt-*`, so
   * pinned headers sit flush at the top of the scroll viewport.
   */
  groupCounts: number[];
  /**
   * For each flat index, the flat index of the surviving last-assistant
   * item within the same group (or `null` when the group has no assistant
   * body item). Pre-computed by `useChatGroups` and indexed 1-to-1 with
   * `flatItems`. Used to surface the regenerate action on the turn's
   * final reply.
   */
  lastAssistantFlatIndexPerItem: (number | null)[];
  isWpGeneWorking: boolean;
  isExploring: boolean;
  codeBlockContainerWidth?: number;
  onRegenerate: (groupIndex: number) => void;
  onSubmit: (eventId: string, answers: Record<string, string>) => void;
  onSkip: (eventId: string) => void;
  onEditUserMessage: (
    item: OptimizedChatItem,
    newText: string,
    imageDataUrls?: string[]
  ) => Promise<void> | void;
  /**
   * When set, the renderer paints a `NewEventDivider` immediately
   * above each group's *last* item. Subagent panes use this so the
   * latest assistant event in every turn is visually called out —
   * matches the "---- New event ----" divider in
   * `Communication > messages`. `null` / undefined leaves the
   * divider off (default).
   */
  newEventDividerLabel?: string | null;
}

/**
 * Renders a single flat item within a GroupedVirtuoso group, wrapped in
 * an AgentTurnContext so descendants can surface turn-scoped actions
 * (e.g. Regenerate) without prop-drilling through the event registry.
 *
 * Note: the shared "Agent worked for …" collapse is applied
 * STRUCTURALLY in `useChatGroups` — collapsed body items are dropped
 * from `flatItems` and `groupCounts` before they ever reach this
 * renderer. Doing the hide here (via `return null`) leaves Virtuoso's
 * per-item size cache pointing at the pre-collapse heights, which
 * shows up as a tall blank tail beneath the surviving last reply.
 */
// memo: per-item renderer called 30-50x for each visible viewport.
// Parent (`ChatHistoryList`) is also memo'd and produces a stable
// `renderGroupItem` via `useCallback`, so we receive identical prop
// references across non-content re-renders.
export const GroupItemRenderer: React.FC<GroupItemRendererProps> = memo(
  ({
    flatIndex,
    groupIndex,
    flatItems,
    groupCounts,
    lastAssistantFlatIndexPerItem,
    isWpGeneWorking,
    isExploring,
    codeBlockContainerWidth,
    onRegenerate,
    onSubmit,
    onSkip,
    onEditUserMessage,
    newEventDividerLabel = null,
  }) => {
    const { t } = useTranslation("sessions");
    const chatItem = flatItems[flatIndex];
    const groupChat = useGroupChatContext();
    const event = chatItem?.event;

    const simpleMessage = useMemo(() => {
      if (!groupChat?.enabled || !event) return null;
      return resolveGroupChatMessageBubble(
        event,
        groupChat.coordinatorSessionId,
        groupChat.orgMembers
      );
    }, [groupChat, event]);

    const previousSimpleMessage = (() => {
      if (!groupChat?.enabled) return null;
      for (
        let previousIndex = flatIndex - 1;
        previousIndex >= 0;
        previousIndex--
      ) {
        const previousItem = flatItems[previousIndex];
        if (!previousItem || previousItem.structuralOnly) continue;
        if (getUnloadedTurnMeta(previousItem) !== null) continue;
        const previousEvent = previousItem.event;
        if (!previousEvent) continue;
        const message = resolveGroupChatMessageBubble(
          previousEvent,
          groupChat.coordinatorSessionId,
          groupChat.orgMembers
        );
        if (!message) return null;
        return { event: previousEvent, message };
      }
      return null;
    })();

    const inboxTranscriptLabel = useMemo(() => {
      if (!event || simpleMessage) return null;
      if (!isAgentOrgInboxTranscriptEvent(event)) return null;
      return t("groupChat.inboxTranscript.readMessages", {
        defaultValue: "Coordinator read messages sent by other agents",
      });
    }, [event, simpleMessage, t]);

    const usesGroupChatMessageBubble = simpleMessage !== null;
    const showGroupBubbleSenderChrome =
      simpleMessage !== null &&
      (previousSimpleMessage?.message.senderName !== simpleMessage.senderName ||
        !event ||
        !isWithinGroupChatContinuationWindow(
          previousSimpleMessage.event.createdAt,
          event.createdAt
        ));
    const groupChatToolUseSummary = useMemo(() => {
      if (!groupChat?.enabled || !event || !simpleMessage) return null;
      return resolveGroupChatToolUseSummary(event);
    }, [event, groupChat?.enabled, simpleMessage]);

    const treatAsAgentActivity = Boolean(
      groupChat?.enabled &&
      event?.source === "user" &&
      event &&
      !groupChat.isCoordinatorTurnHeader(event)
    );

    const lastAssistantFlatIndex = chatItem
      ? (lastAssistantFlatIndexPerItem[flatIndex] ?? null)
      : null;

    // Trailing-item turn gap. Placing the 24px gap on the LAST item of
    // each non-final group keeps the next group's sticky header free of
    // top padding — so pinned headers stay flush at the top of the
    // viewport, while the visual turn boundary scrolls away with the
    // previous group's body. Skipped on the final group (no following
    // turn to separate from).
    const groupEndFlatIndex =
      groupCounts
        .slice(0, groupIndex + 1)
        .reduce((sum, count) => sum + count, 0) - 1;
    const isLastItemInGroup = flatIndex === groupEndFlatIndex;
    const isLastGroup = groupIndex === groupCounts.length - 1;
    const turnGapClass = isLastItemInGroup && !isLastGroup ? "pb-6" : "";

    // Memoize the context value so consumers of `AgentTurnContext`
    // (e.g. `RegenerateButton`, `AgentErrorChatItem`) don't re-render
    // every time the parent ticks. Identity changes only when its inputs
    // actually change.
    const turnContext = useMemo<AgentTurnContextValue>(
      () => ({
        lastAssistantFlatIndex,
        isLastGroup,
        isLastItemInGroup,
        onRegenerate: isWpGeneWorking
          ? () => Message.info("Workspace is working!")
          : () => onRegenerate(groupIndex),
        groupSenderName:
          groupChat?.enabled && event && !usesGroupChatMessageBubble
            ? groupChat.resolveSenderName(event)
            : null,
      }),
      [
        lastAssistantFlatIndex,
        isLastGroup,
        isLastItemInGroup,
        isWpGeneWorking,
        onRegenerate,
        groupIndex,
        usesGroupChatMessageBubble,
        groupChat,
        event,
      ]
    );

    const isStructuralUnloadedTurnItem = getUnloadedTurnMeta(chatItem) !== null;
    const isStructuralOnlyItem = chatItem?.structuralOnly === true;
    const groupMessageWrapClass = showGroupBubbleSenderChrome
      ? "!pt-2 !pb-0"
      : "!pt-1 !pb-0";

    const renderedItem =
      chatItem && !isStructuralUnloadedTurnItem && !isStructuralOnlyItem ? (
        inboxTranscriptLabel && event ? (
          <ChatItemWrap variant="text" className="!py-1">
            <InboxTranscriptCard event={event} title={inboxTranscriptLabel} />
          </ChatItemWrap>
        ) : simpleMessage ? (
          <ChatItemWrap variant="text" className={groupMessageWrapClass}>
            <GroupChatMessageBubble
              senderName={simpleMessage.senderName}
              recipientName={simpleMessage.recipientName}
              bodyMarkdown={simpleMessage.bodyMarkdown}
              timestamp={event?.createdAt ?? ""}
              showSenderChrome={showGroupBubbleSenderChrome}
              toolUseSummary={groupChatToolUseSummary}
            />
          </ChatItemWrap>
        ) : (
          <ChatItemRenderer
            chatItem={chatItem}
            index={flatIndex}
            isWpGeneWorking={isWpGeneWorking}
            isExploring={isExploring}
            onSubmit={onSubmit}
            onSkip={onSkip}
            onEditUserMessage={onEditUserMessage}
            codeBlockContainerWidth={codeBlockContainerWidth}
            treatAsAgentActivity={treatAsAgentActivity}
          />
        )
      ) : null;

    // Wrap the rendered item in a guaranteed-non-zero-height container.
    // react-virtuoso measures each item's `offsetHeight`; a zero-height
    // child triggers a "Zero-sized element, this should not happen"
    // console error. The pipeline tries to pre-filter empty events
    // (`willEventRenderContent`) but some shapes still resolve to `null`
    // downstream — e.g. structural collapse rows, raw events with no
    // registered renderer, and unknown chat-item `type`s that fall through
    // to `renderDefault`. The 1px floor keeps Virtuoso's measurement loop
    // quiet without introducing visible whitespace.
    // Per-turn "new event" divider. Painted above the group's last item
    // so subagent panes can signpost the freshest activity inside each
    // round. Suppressed when the surviving last item is a structural
    // collapse stub (would be a divider above nothing meaningful) or
    // when the host doesn't supply a label.
    const showNewEventDivider =
      isLastItemInGroup &&
      typeof newEventDividerLabel === "string" &&
      newEventDividerLabel.length > 0 &&
      !isStructuralUnloadedTurnItem &&
      !isStructuralOnlyItem;

    return (
      <AgentTurnContext.Provider value={turnContext}>
        <div className={turnGapClass || undefined} style={{ minHeight: 1 }}>
          {showNewEventDivider && (
            <NewEventDivider label={newEventDividerLabel as string} />
          )}
          {renderedItem}
        </div>
      </AgentTurnContext.Provider>
    );
  }
);

GroupItemRenderer.displayName = "GroupItemRenderer";
