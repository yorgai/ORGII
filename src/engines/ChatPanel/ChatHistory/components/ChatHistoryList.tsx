/**
 * ChatHistoryList
 *
 * Pure list rendering: static path for header-only turns and GroupedVirtuoso
 * for any list with body items. Extracted from `ChatHistory/index.tsx` to keep that file
 * under the 600-line limit.
 *
 * Receives all data and callbacks as props — no atom reads here.
 */
import React, { memo, useMemo } from "react";
import {
  type Components,
  GroupedVirtuoso,
  type GroupedVirtuosoHandle,
} from "react-virtuoso";

import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import { PlanningFooter } from "@src/engines/ChatPanel/blocks/primitives";

import type { OptimizedChatItem } from "../chatItemPipeline/types";
import type { ChatGroupMeta } from "../hooks";
import { GroupItemRenderer } from "../renderers";

const STATIC_RENDER_ITEM_LIMIT = 24;

interface ChatHistoryListProps {
  flatItems: OptimizedChatItem[];
  groupCounts: number[];
  groupHeaders: (OptimizedChatItem | null)[];
  groupMeta: ChatGroupMeta[];
  totalFlatItems: number;
  lastAssistantFlatIndexPerItem: (number | null)[];
  codeBlockContainerWidth: number;
  footerSpacerHeight: number;
  planningIndicatorCount: number;
  planningShowSlowHint: boolean;
  planningVariantIndex: number;
  virtuosoRef: React.RefObject<GroupedVirtuosoHandle>;
  virtuosoDataKey: string;
  /**
   * Stable getter returning whether work-product generation is active.
   * Implemented as a function so Virtuoso item callbacks can read the
   * live value without the ref being read during React's render phase.
   */
  getIsWpGeneWorking: () => boolean;
  /**
   * Stable getter returning whether the agent is in "exploring" mode.
   * Same rationale as `getIsWpGeneWorking`.
   */
  getIsExploring: () => boolean;
  followOutput: boolean | ((isAtBottom: boolean) => "smooth" | false);
  renderGroupHeader: (groupIndex: number) => React.ReactNode;
  onAtBottomStateChange: (atBottom: boolean) => void;
  onRangeChanged: (range: { startIndex: number; endIndex: number }) => void;
  onEndReached: () => void;
  onRegenerate: (groupIndex: number) => void;
  onSubmit: (eventId: string, answers: Record<string, string>) => void;
  onSkip: (eventId: string) => void;
  onEditUserMessage: (
    header: OptimizedChatItem,
    text: string,
    images?: string[]
  ) => void;
  /** Opaque Scroller component from `createChatScroller`. */
  ChatScroller: NonNullable<Components["Scroller"]>;
  /**
   * Ref that receives the static-path scroll container (used only when
   * a page has no body items and Virtuoso is not mounted).
   * Allows useChatScrollPin to fall back to scrolling this element on
   * session switches instead of silently failing.
   */
  staticScrollerRef?: React.MutableRefObject<HTMLDivElement | null>;
  /**
   * When set, `GroupItemRenderer` paints a `NewEventDivider` with this
   * label above each group's last item. Subagent panes opt in so the
   * freshest event in every turn is signposted. `null` / undefined
   * keeps the divider off (default for the main chat panel).
   */
  newEventDividerLabel?: string | null;
}

// memo: parent (`ChatHistory/index.tsx`) re-renders on every chat event
// (atom subscriptions, useDeferredValue ticks). All props are either
// primitives, useCallback-wrapped, refs, or arrays/objects produced by
// upstream useMemo (e.g. `useChatTurnPagination`), so default shallow
// compare is sufficient to skip the whole GroupedVirtuoso re-render
// during non-content updates.
const ChatHistoryList: React.FC<ChatHistoryListProps> = memo(
  ({
    flatItems,
    groupCounts,
    totalFlatItems,
    lastAssistantFlatIndexPerItem,
    codeBlockContainerWidth,
    footerSpacerHeight,
    planningIndicatorCount,
    planningShowSlowHint,
    planningVariantIndex,
    virtuosoRef,
    virtuosoDataKey,
    getIsWpGeneWorking,
    getIsExploring,
    followOutput,
    renderGroupHeader: renderGroupHeaderProp,
    onAtBottomStateChange,
    onRangeChanged,
    onEndReached,
    onRegenerate,
    onSubmit,
    onSkip,
    onEditUserMessage,
    ChatScroller,
    staticScrollerRef,
    newEventDividerLabel = null,
  }) => {
    // When the planning indicator is active, inject it as a virtual item
    // in the last group so it renders under the latest turn's sticky
    // header — not as the global Virtuoso Footer which visually attaches
    // to the previous turn when the latest group has 0 body items.
    const hasPlanningItem =
      planningIndicatorCount > 0 && groupCounts.length > 0;
    const effectiveGroupCounts = useMemo(() => {
      if (!hasPlanningItem) return groupCounts;
      const adjusted = [...groupCounts];
      adjusted[adjusted.length - 1] += 1;
      return adjusted;
    }, [hasPlanningItem, groupCounts]);
    const effectiveTotalFlatItems = totalFlatItems + (hasPlanningItem ? 1 : 0);

    const useStaticRendering =
      effectiveTotalFlatItems <= STATIC_RENDER_ITEM_LIMIT;

    const staticGroups = useMemo(() => {
      if (!useStaticRendering) return [];
      return effectiveGroupCounts.map((groupItemCount, groupIndex) => {
        const groupStartFlatIndex = effectiveGroupCounts
          .slice(0, groupIndex)
          .reduce((sum, count) => sum + count, 0);
        return {
          groupIndex,
          itemIndexes: Array.from(
            { length: groupItemCount },
            (_, itemOffset) => groupStartFlatIndex + itemOffset
          ),
        };
      });
    }, [useStaticRendering, effectiveGroupCounts]);

    const virtuosoComponents = useMemo(() => {
      const List = React.forwardRef<
        HTMLDivElement,
        React.HTMLAttributes<HTMLDivElement>
      >(({ style, className = "", ...props }, ref) => (
        <div
          {...props}
          ref={ref}
          className={`mx-auto w-full ${DETAIL_PANEL_TOKENS.contentMaxWidth} ${className}`.trim()}
          style={style}
        />
      ));
      List.displayName = "ChatHistoryVirtuosoList";

      return {
        Scroller: ChatScroller,
        List,
        Footer: () => <div style={{ height: footerSpacerHeight }} />,
      };
    }, [ChatScroller, footerSpacerHeight]);

    const renderGroupItem = React.useCallback(
      (flatIndex: number, groupIndex: number) => {
        if (flatIndex >= flatItems.length) {
          return (
            <PlanningFooter
              count={planningIndicatorCount}
              showSlowHint={planningShowSlowHint}
              variantIndex={planningVariantIndex}
            />
          );
        }
        return (
          <GroupItemRenderer
            flatIndex={flatIndex}
            groupIndex={groupIndex}
            flatItems={flatItems}
            groupCounts={effectiveGroupCounts}
            lastAssistantFlatIndexPerItem={lastAssistantFlatIndexPerItem}
            isWpGeneWorking={getIsWpGeneWorking()}
            isExploring={getIsExploring()}
            codeBlockContainerWidth={codeBlockContainerWidth}
            onRegenerate={onRegenerate}
            onSubmit={onSubmit}
            onSkip={onSkip}
            onEditUserMessage={onEditUserMessage}
            newEventDividerLabel={newEventDividerLabel}
          />
        );
      },
      [
        flatItems,
        effectiveGroupCounts,
        lastAssistantFlatIndexPerItem,
        codeBlockContainerWidth,
        getIsWpGeneWorking,
        getIsExploring,
        onRegenerate,
        onSubmit,
        onSkip,
        onEditUserMessage,
        newEventDividerLabel,
        planningIndicatorCount,
        planningShowSlowHint,
        planningVariantIndex,
      ]
    );

    const renderGroupHeader = React.useCallback(
      (groupIndex: number) => renderGroupHeaderProp(groupIndex),
      [renderGroupHeaderProp]
    );

    const handleFollowOutput = React.useCallback(
      (isAtBottom: boolean) => {
        if (typeof followOutput === "boolean") return followOutput;
        return followOutput(isAtBottom) !== false;
      },
      [followOutput]
    );

    if (useStaticRendering) {
      return (
        <div
          ref={staticScrollerRef}
          className="h-full overflow-y-auto overscroll-contain scrollbar-hide"
        >
          <div
            className={`mx-auto min-h-full w-full ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
          >
            {staticGroups.map(({ groupIndex, itemIndexes }) => (
              <div key={`static-group-${groupIndex}`} className="relative">
                <div className="sticky top-0 z-20">
                  {renderGroupHeaderProp(groupIndex)}
                </div>
                {itemIndexes.map((itemFlatIndex) => {
                  if (itemFlatIndex >= flatItems.length) {
                    return (
                      <PlanningFooter
                        key="planning-footer"
                        count={planningIndicatorCount}
                        showSlowHint={planningShowSlowHint}
                        variantIndex={planningVariantIndex}
                      />
                    );
                  }
                  const itemKey =
                    flatItems[itemFlatIndex]?.chunk_id ??
                    `static-chat-${itemFlatIndex}`;
                  return (
                    <GroupItemRenderer
                      key={itemKey}
                      flatIndex={itemFlatIndex}
                      groupIndex={groupIndex}
                      flatItems={flatItems}
                      groupCounts={effectiveGroupCounts}
                      lastAssistantFlatIndexPerItem={
                        lastAssistantFlatIndexPerItem
                      }
                      isWpGeneWorking={false}
                      isExploring={false}
                      codeBlockContainerWidth={codeBlockContainerWidth}
                      onRegenerate={onRegenerate}
                      onSubmit={onSubmit}
                      onSkip={onSkip}
                      onEditUserMessage={onEditUserMessage}
                      newEventDividerLabel={newEventDividerLabel}
                    />
                  );
                })}
              </div>
            ))}
            <div style={{ height: footerSpacerHeight }} />
          </div>
        </div>
      );
    }

    return (
      <GroupedVirtuoso
        key={virtuosoDataKey}
        ref={virtuosoRef}
        style={{
          height: "100%",
          width: "100%",
          overscrollBehavior: "contain",
        }}
        groupCounts={effectiveGroupCounts}
        groupContent={renderGroupHeader}
        itemContent={renderGroupItem}
        atBottomStateChange={onAtBottomStateChange}
        rangeChanged={onRangeChanged}
        endReached={onEndReached}
        followOutput={handleFollowOutput}
        atBottomThreshold={80}
        initialTopMostItemIndex={
          effectiveTotalFlatItems > 0 ? effectiveTotalFlatItems - 1 : 0
        }
        overscan={{ main: 1200, reverse: 1200 }}
        increaseViewportBy={{ top: 1000, bottom: 1000 }}
        defaultItemHeight={280}
        computeItemKey={(flatIndex) =>
          flatIndex >= flatItems.length
            ? "planning-footer"
            : flatItems[flatIndex]?.chunk_id || `chat-${flatIndex}`
        }
        className="scrollbar-hide"
        components={virtuosoComponents}
      />
    );
  }
);

ChatHistoryList.displayName = "ChatHistoryList";

export default ChatHistoryList;
