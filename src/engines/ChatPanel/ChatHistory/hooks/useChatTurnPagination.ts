import { useMemo } from "react";

import type { CursorIdeTurnSummary } from "@src/api/tauri/cursorIde";

import type { OptimizedChatItem } from "../chatItemPipeline/types";
import type { ChatGroupMeta } from "./useChatGroups";

interface ChatTurnPage {
  startGroupIndex: number;
  endGroupIndex: number;
  flatStartIndex: number;
  flatEndIndex: number;
  cursorIdeSummary: CursorIdeTurnSummary | null;
}

interface UseChatTurnPaginationOptions {
  enabled: boolean;
  activePageIndex: number;
  groupCounts: number[];
  groupHeaders: (OptimizedChatItem | null)[];
  groupMeta: ChatGroupMeta[];
  flatItems: OptimizedChatItem[];
  lastAssistantFlatIndexPerItem: (number | null)[];
  cursorIdeTurnSummaries?: CursorIdeTurnSummary[];
}

export interface UseChatTurnPaginationReturn {
  pageCount: number;
  currentPageIndex: number;
  pages: ChatTurnPage[];
  displayGroupCounts: number[];
  displayGroupHeaders: (OptimizedChatItem | null)[];
  displayGroupMeta: ChatGroupMeta[];
  displayFlatItems: OptimizedChatItem[];
  displayTotalFlatItems: number;
  displayLastAssistantFlatIndexPerItem: (number | null)[];
  displaySourceGroupIndices: number[];
  displayLastGroupFirstFlatIndex: number | null;
}

export function useChatTurnPagination({
  enabled,
  activePageIndex,
  groupCounts,
  groupHeaders,
  groupMeta,
  flatItems,
  lastAssistantFlatIndexPerItem,
  cursorIdeTurnSummaries = [],
}: UseChatTurnPaginationOptions): UseChatTurnPaginationReturn {
  return useMemo(() => {
    const pages = buildTurnPages(
      groupCounts,
      groupHeaders,
      cursorIdeTurnSummaries
    );
    const pageCount = pages.length;
    const currentPageIndex = clampPageIndex(activePageIndex, pageCount);

    if (!enabled || pageCount === 0) {
      return {
        pageCount,
        currentPageIndex,
        pages,
        displayGroupCounts: groupCounts,
        displayGroupHeaders: groupHeaders,
        displayGroupMeta: groupMeta,
        displayFlatItems: flatItems,
        displayTotalFlatItems: flatItems.length,
        displayLastAssistantFlatIndexPerItem: lastAssistantFlatIndexPerItem,
        displaySourceGroupIndices: groupCounts.map(
          (_, groupIndex) => groupIndex
        ),
        displayLastGroupFirstFlatIndex: computeLastGroupFirstFlatIndex(
          groupCounts,
          flatItems.length
        ),
      };
    }

    const page = pages[currentPageIndex];
    if (!page) {
      return {
        pageCount,
        currentPageIndex,
        pages,
        displayGroupCounts: [],
        displayGroupHeaders: [],
        displayGroupMeta: [],
        displayFlatItems: [],
        displayTotalFlatItems: 0,
        displayLastAssistantFlatIndexPerItem: [],
        displaySourceGroupIndices: [],
        displayLastGroupFirstFlatIndex: null,
      };
    }

    const displayGroupCounts = groupCounts.slice(
      page.startGroupIndex,
      page.endGroupIndex + 1
    );
    const displayFlatItems = flatItems.slice(
      page.flatStartIndex,
      page.flatEndIndex
    );
    const displayLastAssistantFlatIndexPerItem = lastAssistantFlatIndexPerItem
      .slice(page.flatStartIndex, page.flatEndIndex)
      .map((flatIndex) => {
        if (flatIndex === null) return null;
        if (flatIndex < page.flatStartIndex || flatIndex >= page.flatEndIndex) {
          return null;
        }
        return flatIndex - page.flatStartIndex;
      });

    return {
      pageCount,
      currentPageIndex,
      pages,
      displayGroupCounts,
      displayGroupHeaders: groupHeaders.slice(
        page.startGroupIndex,
        page.endGroupIndex + 1
      ),
      displayGroupMeta: groupMeta.slice(
        page.startGroupIndex,
        page.endGroupIndex + 1
      ),
      displayFlatItems,
      displayTotalFlatItems: displayFlatItems.length,
      displayLastAssistantFlatIndexPerItem,
      displaySourceGroupIndices: displayGroupCounts.map(
        (_, offset) => page.startGroupIndex + offset
      ),
      displayLastGroupFirstFlatIndex: computeLastGroupFirstFlatIndex(
        displayGroupCounts,
        displayFlatItems.length
      ),
    };
  }, [
    enabled,
    activePageIndex,
    groupCounts,
    groupHeaders,
    groupMeta,
    flatItems,
    lastAssistantFlatIndexPerItem,
    cursorIdeTurnSummaries,
  ]);
}

function buildTurnPages(
  groupCounts: number[],
  groupHeaders: (OptimizedChatItem | null)[],
  cursorIdeTurnSummaries: CursorIdeTurnSummary[]
): ChatTurnPage[] {
  if (cursorIdeTurnSummaries.length > 0) {
    return buildCursorIdeTurnPages(
      groupCounts,
      groupHeaders,
      cursorIdeTurnSummaries
    );
  }

  const rawPages: ChatTurnPage[] = [];
  let startGroupIndex = 0;
  let flatCursor = 0;
  let pageFlatStartIndex = 0;

  for (let groupIndex = 0; groupIndex < groupCounts.length; groupIndex++) {
    const count = groupCounts[groupIndex] ?? 0;
    const nextFlatCursor = flatCursor + count;
    const hasAgentItems = count > 0;
    const hasUserHeader = groupHeaders[groupIndex] !== null;
    const isLastGroup = groupIndex === groupCounts.length - 1;

    if (hasUserHeader || hasAgentItems || isLastGroup) {
      rawPages.push({
        startGroupIndex,
        endGroupIndex: groupIndex,
        flatStartIndex: pageFlatStartIndex,
        flatEndIndex: nextFlatCursor,
        cursorIdeSummary: null,
      });
      startGroupIndex = groupIndex + 1;
      pageFlatStartIndex = nextFlatCursor;
    }

    flatCursor = nextFlatCursor;
  }

  return rawPages;
}

function buildCursorIdeTurnPages(
  groupCounts: number[],
  groupHeaders: (OptimizedChatItem | null)[],
  cursorIdeTurnSummaries: CursorIdeTurnSummary[]
): ChatTurnPage[] {
  const groupByTurnId = new Map<string, number>();
  for (let groupIndex = 0; groupIndex < groupHeaders.length; groupIndex++) {
    const eventId = groupHeaders[groupIndex]?.event?.id;
    if (!eventId?.startsWith("cursoride-user-")) continue;
    groupByTurnId.set(eventId.slice("cursoride-user-".length), groupIndex);
  }

  const groupFlatStartIndices = computeGroupFlatStartIndices(groupCounts);
  const fallbackGroupIndex = Math.max(0, groupCounts.length - 1);
  return cursorIdeTurnSummaries.map((summary) => {
    const groupIndex = groupByTurnId.get(summary.turnId) ?? fallbackGroupIndex;
    const flatStartIndex = groupFlatStartIndices[groupIndex] ?? 0;
    const flatEndIndex = flatStartIndex + (groupCounts[groupIndex] ?? 0);
    return {
      startGroupIndex: groupIndex,
      endGroupIndex: groupIndex,
      flatStartIndex,
      flatEndIndex,
      cursorIdeSummary: summary,
    };
  });
}

function computeGroupFlatStartIndices(groupCounts: number[]): number[] {
  const indices: number[] = [];
  let flatStartIndex = 0;
  for (const count of groupCounts) {
    indices.push(flatStartIndex);
    flatStartIndex += count;
  }
  return indices;
}

function clampPageIndex(pageIndex: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  return Math.min(Math.max(pageIndex, 0), pageCount - 1);
}

function computeLastGroupFirstFlatIndex(
  groupCounts: number[],
  flatItemCount: number
): number | null {
  if (groupCounts.length === 0) return null;
  const tailCount = groupCounts[groupCounts.length - 1] ?? 0;
  if (tailCount <= 0) return null;
  return flatItemCount - tailCount;
}
