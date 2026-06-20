/**
 * ChatHistoryList
 *
 * Pure list rendering: static path for header-only turns and GroupedVirtuoso
 * for any list with body items. Extracted from `ChatHistory/index.tsx` to keep that file
 * under the 600-line limit.
 *
 * Receives all data and callbacks as props — no atom reads here.
 */
import React, { memo, useMemo, useRef } from "react";
import {
  type Components,
  GroupedVirtuoso,
  type GroupedVirtuosoHandle,
} from "react-virtuoso";

import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import { PlanningFooter } from "@src/engines/ChatPanel/blocks/primitives";

import type { OptimizedChatItem } from "../chatItemPipeline/types";
import { CHAT_FOOTER_SPACER } from "../config/chatFooterSpacer";
import { getUnloadedTurnMeta } from "../hooks/useChatGroups";
import { GroupItemRenderer } from "../renderers";

const STATIC_RENDER_ITEM_LIMIT = 24;

function sameNumberArray(
  left: readonly number[],
  right: readonly number[]
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function sameNullableNumberArray(
  left: readonly (number | null)[],
  right: readonly (number | null)[]
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

type EventSummary = NonNullable<OptimizedChatItem["event"]>;

function sameEventSummary(
  left: EventSummary | undefined,
  right: EventSummary | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.id === right.id &&
    left.displayText === right.displayText &&
    left.displayStatus === right.displayStatus &&
    left.displayVariant === right.displayVariant
  );
}

function sameEventList(
  left: readonly EventSummary[] | undefined,
  right: readonly EventSummary[] | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.every((leftEvent, index) =>
    sameEventSummary(leftEvent, right[index])
  );
}

function sameFlatItems(
  left: readonly OptimizedChatItem[],
  right: readonly OptimizedChatItem[]
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((leftItem, index) => {
    const rightItem = right[index];
    return (
      rightItem !== undefined &&
      leftItem.chunk_id === rightItem.chunk_id &&
      leftItem.type === rightItem.type &&
      leftItem.consolidatedParts === rightItem.consolidatedParts &&
      leftItem.repeatedErrorCount === rightItem.repeatedErrorCount &&
      leftItem.structuralOnly === rightItem.structuralOnly &&
      sameEventSummary(leftItem.event, rightItem.event) &&
      sameEventList(leftItem.readFileEvents, rightItem.readFileEvents) &&
      sameEventList(
        leftItem.activityStackGroup?.events,
        rightItem.activityStackGroup?.events
      ) &&
      sameEventList(
        leftItem.actionSummaryItems?.map((item) => item.event),
        rightItem.actionSummaryItems?.map((item) => item.event)
      )
    );
  });
}

function sameChatHistoryListProps(
  previous: ChatHistoryListProps,
  next: ChatHistoryListProps
): boolean {
  const sameFooterSpacer =
    Math.abs(previous.footerSpacerHeight - next.footerSpacerHeight) <
    CHAT_FOOTER_SPACER.UPDATE_THRESHOLD_PX;
  const checks: Array<[string, boolean]> = [
    ["flatItems", sameFlatItems(previous.flatItems, next.flatItems)],
    ["groupCounts", sameNumberArray(previous.groupCounts, next.groupCounts)],
    ["totalFlatItems", previous.totalFlatItems === next.totalFlatItems],
    [
      "lastAssistantFlatIndexPerItem",
      sameNullableNumberArray(
        previous.lastAssistantFlatIndexPerItem,
        next.lastAssistantFlatIndexPerItem
      ),
    ],
    [
      "codeBlockContainerWidth",
      previous.codeBlockContainerWidth === next.codeBlockContainerWidth,
    ],
    ["footerSpacerHeight", sameFooterSpacer],
    [
      "planningIndicatorCount",
      previous.planningIndicatorCount === next.planningIndicatorCount,
    ],
    [
      "planningShowSlowHint",
      previous.planningShowSlowHint === next.planningShowSlowHint,
    ],
    [
      "planningVariantIndex",
      previous.planningVariantIndex === next.planningVariantIndex,
    ],
    ["virtuosoRef", previous.virtuosoRef === next.virtuosoRef],
    ["virtuosoDataKey", previous.virtuosoDataKey === next.virtuosoDataKey],
    [
      "getIsWpGeneWorking",
      previous.getIsWpGeneWorking === next.getIsWpGeneWorking,
    ],
    ["getIsExploring", previous.getIsExploring === next.getIsExploring],
    ["followOutput", previous.followOutput === next.followOutput],
    [
      "renderGroupHeader",
      previous.renderGroupHeader === next.renderGroupHeader,
    ],
    [
      "onAtBottomStateChange",
      previous.onAtBottomStateChange === next.onAtBottomStateChange,
    ],
    ["onRangeChanged", previous.onRangeChanged === next.onRangeChanged],
    ["onEndReached", previous.onEndReached === next.onEndReached],
    ["onRegenerate", previous.onRegenerate === next.onRegenerate],
    ["onSubmit", previous.onSubmit === next.onSubmit],
    ["onSkip", previous.onSkip === next.onSkip],
    [
      "onEditUserMessage",
      previous.onEditUserMessage === next.onEditUserMessage,
    ],
    ["ChatScroller", previous.ChatScroller === next.ChatScroller],
    [
      "staticScrollerRef",
      previous.staticScrollerRef === next.staticScrollerRef,
    ],
    [
      "newEventDividerLabel",
      previous.newEventDividerLabel === next.newEventDividerLabel,
    ],
  ];
  return checks.every(([, same]) => same);
}

interface ChatHistoryListProps {
  flatItems: OptimizedChatItem[];
  groupCounts: number[];
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
    // Planning indicator state in refs so polling ticks don't invalidate
    // renderGroupItem's useCallback (Root Cause 2 fix).
    const planningIndicatorCountRef = useRef(planningIndicatorCount);
    planningIndicatorCountRef.current = planningIndicatorCount;
    const planningShowSlowHintRef = useRef(planningShowSlowHint);
    planningShowSlowHintRef.current = planningShowSlowHint;
    const planningVariantIndexRef = useRef(planningVariantIndex);
    planningVariantIndexRef.current = planningVariantIndex;

    // flatItems and previousChatItems in refs so renderGroupItem's useCallback
    // is not re-created on every token during streaming (Root Cause 1 fix).
    const flatItemsRef = useRef(flatItems);
    flatItemsRef.current = flatItems;
    const previousChatItemsRef = useRef<(OptimizedChatItem | undefined)[]>([]);

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

    // For each flat index, the nearest preceding qualifying item — non-structural,
    // non-unloaded, with an event. Pre-computed once per flatItems change so
    // GroupItemRenderer doesn't run an O(N) backward scan on every render
    // (Root Cause 3 fix / Root Cause 1 fix combined).
    const previousChatItems = useMemo<(OptimizedChatItem | undefined)[]>(() => {
      const result: (OptimizedChatItem | undefined)[] = new Array(
        flatItems.length
      ).fill(undefined);
      let lastQualifying: OptimizedChatItem | undefined = undefined;
      for (let i = 0; i < flatItems.length; i++) {
        result[i] = lastQualifying;
        const item = flatItems[i];
        if (
          item &&
          !item.structuralOnly &&
          getUnloadedTurnMeta(item) === null &&
          item.event
        ) {
          lastQualifying = item;
        }
      }
      previousChatItemsRef.current = result;
      return result;
    }, [flatItems]);

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

    // Keep footerSpacerHeight in a ref so the Footer component can read the
    // latest value without being re-created. Virtuoso unmounts and remounts
    // Footer whenever `components` changes identity, so keeping Footer stable
    // avoids that churn even as footerSpacerHeight updates.
    const footerSpacerHeightRef = useRef(footerSpacerHeight);
    footerSpacerHeightRef.current = footerSpacerHeight;

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const FooterComponent = useMemo(
      () =>
        function ChatFooterSpacer() {
          return <div style={{ height: footerSpacerHeightRef.current }} />;
        },
      // Empty deps: FooterComponent is intentionally stable for the lifetime
      // of this ChatHistoryList instance. It reads footerSpacerHeightRef.current
      // on each Virtuoso-triggered render, so footerSpacerHeight changes are
      // still reflected without recreating the component.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      []
    );

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
        Footer: FooterComponent,
      };
    }, [ChatScroller, FooterComponent]);

    const renderGroupItem = React.useCallback(
      (flatIndex: number, groupIndex: number) => {
        const currentFlatItems = flatItemsRef.current;
        if (flatIndex >= currentFlatItems.length) {
          return (
            <PlanningFooter
              key={`planning-footer-${flatIndex}`}
              count={planningIndicatorCountRef.current}
              showSlowHint={planningShowSlowHintRef.current}
              variantIndex={planningVariantIndexRef.current}
            />
          );
        }
        return (
          <GroupItemRenderer
            flatIndex={flatIndex}
            groupIndex={groupIndex}
            chatItem={currentFlatItems[flatIndex]}
            previousChatItem={previousChatItemsRef.current[flatIndex]}
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
      ]
    );

    const renderGroupHeader = React.useCallback(
      (groupIndex: number) => (
        <div className="relative z-[60]">
          {renderGroupHeaderProp(groupIndex)}
        </div>
      ),
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
                <div className="sticky top-0 z-[60]">
                  {renderGroupHeaderProp(groupIndex)}
                </div>
                {itemIndexes.map((itemFlatIndex) => {
                  if (itemFlatIndex >= flatItems.length) {
                    return (
                      <PlanningFooter
                        key={`planning-footer-${itemFlatIndex}`}
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
                      chatItem={flatItems[itemFlatIndex]}
                      previousChatItem={previousChatItems[itemFlatIndex]}
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
            ? `planning-footer-${flatIndex}`
            : flatItems[flatIndex]?.chunk_id || `chat-${flatIndex}`
        }
        className="scrollbar-hide"
        components={virtuosoComponents}
      />
    );
  },
  sameChatHistoryListProps
);

ChatHistoryList.displayName = "ChatHistoryList";

export default ChatHistoryList;
