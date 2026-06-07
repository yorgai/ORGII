import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { benchmarkApi } from "@src/api/tauri/benchmark";
import { createLogger } from "@src/hooks/logger";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import { benchmarkAgentBatchStatusAtom } from "@src/store/benchmark";
import {
  type Session,
  type SessionListCategory,
  sessionPaginationAtom,
} from "@src/store/session";
import { isPrimarySessionListSession } from "@src/util/session/sessionVisibility";

import {
  DEFAULT_GROUP_VISIBLE_COUNT,
  type DateGroupKey,
} from "./dateGroupingHelpers";
import {
  buildSessionMenuItem,
  isBenchmarkSessionRow,
  separator,
} from "./menuItemBuilders";
import {
  buildByAgentMenuItems,
  buildByTagsMenuItems,
  buildByTimeMenuItems,
  buildByWorkspaceMenuItems,
} from "./menuSectionBuilders";
import {
  LOAD_MORE_CATEGORIES,
  appendSessionGroup,
  getLoadMoreGroupId,
  isLoadMoreId,
  loadMoreRow,
} from "./paginationHelpers";
import type {
  UseSessionMenuItemsParams,
  UseSessionMenuItemsResult,
} from "./types";

export { getLoadMoreGroupId, isLoadMoreId } from "./paginationHelpers";

const logger = createLogger("SessionSidebar");

export function useSessionMenuItems({
  sortedSessions,
  visitedSessions,
  repoPathToName,
  groupByMode,
  untitledSession,
  groupVisibleCounts,
}: UseSessionMenuItemsParams): UseSessionMenuItemsResult {
  const { t: tCommon } = useTranslation();
  const pagination = useAtomValue(sessionPaginationAtom);
  const benchmarkAgentBatchStatus = useAtomValue(benchmarkAgentBatchStatusAtom);
  const [benchmarkHistoryChildSessionIds, setBenchmarkHistoryChildSessionIds] =
    useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    benchmarkApi
      .listAgentBatchHistories()
      .then((histories) => {
        if (cancelled) return;
        setBenchmarkHistoryChildSessionIds(
          new Set(
            histories.flatMap((history) =>
              history.items
                .map((item) => item.sessionId)
                .filter((sessionId): sessionId is string => Boolean(sessionId))
            )
          )
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logger.warn("Failed to load benchmark batch histories:", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const benchmarkChildSessionIds = useMemo(
    () =>
      new Set(
        benchmarkAgentBatchStatus?.items
          .map((item) => item.sessionId)
          .filter((sessionId): sessionId is string => Boolean(sessionId)) ?? []
      ),
    [benchmarkAgentBatchStatus?.items]
  );

  const benchmarkCoordinatorSessionIds = useMemo(
    () =>
      new Set(
        sortedSessions
          .filter(isBenchmarkSessionRow)
          .map((session) => session.session_id)
      ),
    [sortedSessions]
  );

  const visibleSessions = useMemo(
    () =>
      sortedSessions.filter(
        (session) =>
          isPrimarySessionListSession(session) &&
          !benchmarkChildSessionIds.has(session.session_id) &&
          !benchmarkHistoryChildSessionIds.has(session.session_id) &&
          !benchmarkCoordinatorSessionIds.has(session.parentSessionId ?? "")
      ),
    [
      benchmarkChildSessionIds,
      benchmarkCoordinatorSessionIds,
      benchmarkHistoryChildSessionIds,
      sortedSessions,
    ]
  );

  const pinnedSessions = useMemo(
    () => visibleSessions.filter((session) => session.pinned),
    [visibleSessions]
  );

  const unpinnedSessions = useMemo(
    () => visibleSessions.filter((session) => !session.pinned),
    [visibleSessions]
  );

  const sessionMap = useMemo(() => {
    const map = new Map<string, Session>();
    for (const session of visibleSessions) {
      map.set(session.session_id, session);
    }
    return map;
  }, [visibleSessions]);

  const buildSessionRow = useCallback(
    (session: Session): NavigationMenuItem =>
      buildSessionMenuItem({ session, untitledSession, visitedSessions }),
    [untitledSession, visitedSessions]
  );

  const loadMoreRowFor = useCallback(
    (category: SessionListCategory): NavigationMenuItem | null => {
      const state = pagination[category];
      if (!state.hasMore && !state.loading) return null;
      const label = state.loading
        ? tCommon("sessions:chat.loading")
        : tCommon("common:actions.loadMore");
      return loadMoreRow(category, state.loading, label);
    },
    [pagination, tCommon]
  );

  const trailingLoadMoreItems = useMemo<NavigationMenuItem[]>(() => {
    const rows: NavigationMenuItem[] = [];
    for (const category of LOAD_MORE_CATEGORIES) {
      const row = loadMoreRowFor(category);
      if (row) rows.push(row);
    }
    return rows;
  }, [loadMoreRowFor]);

  const appendTrailingLoadMoreItems = useCallback(
    (items: NavigationMenuItem[]) => {
      if (trailingLoadMoreItems.length === 0) return;
      items.push(separator("backend-load-more"));
      items.push(...trailingLoadMoreItems);
    },
    [trailingLoadMoreItems]
  );

  const appendGroupSessions = useCallback(
    (
      items: NavigationMenuItem[],
      groupId: string,
      groupSessions: readonly Session[]
    ): boolean => {
      const visibleCount =
        groupVisibleCounts.get(groupId) ?? DEFAULT_GROUP_VISIBLE_COUNT;
      return appendSessionGroup({
        items,
        groupId,
        groupSessions,
        visibleCount,
        buildSessionRow,
        loadMoreLabel: tCommon("common:actions.loadMore"),
      });
    },
    [buildSessionRow, groupVisibleCounts, tCommon]
  );

  const dateGroupLabels: Record<DateGroupKey, string> = useMemo(
    () => ({
      today: tCommon("sessions:chat.historyToday", "Today"),
      yesterday: tCommon("sessions:chat.historyYesterday", "Yesterday"),
      thisWeek: tCommon("sessions:chat.historyThisWeek", "This Week"),
      older: tCommon("sessions:chat.historyOlder", "Older"),
    }),
    [tCommon]
  );

  const pinnedLabel = tCommon("sessions:chat.historyPinned", "Pinned");

  const appendPinnedSessions = useCallback(
    (items: NavigationMenuItem[]): boolean => {
      if (pinnedSessions.length === 0) return false;
      items.push(separator("pinned", pinnedLabel));
      return appendGroupSessions(items, "pinned", pinnedSessions);
    },
    [appendGroupSessions, pinnedLabel, pinnedSessions]
  );

  const byTimeMenuItems = useMemo<NavigationMenuItem[]>(
    () =>
      buildByTimeMenuItems({
        unpinnedSessions,
        dateGroupLabels,
        appendPinnedSessions,
        appendGroupSessions,
        appendTrailingLoadMoreItems,
      }),
    [
      unpinnedSessions,
      dateGroupLabels,
      appendPinnedSessions,
      appendGroupSessions,
      appendTrailingLoadMoreItems,
    ]
  );

  const byAgentMenuItems = useMemo<NavigationMenuItem[]>(
    () =>
      buildByAgentMenuItems({
        unpinnedSessions,
        appendPinnedSessions,
        appendGroupSessions,
        loadMoreRowFor,
      }),
    [
      unpinnedSessions,
      appendPinnedSessions,
      appendGroupSessions,
      loadMoreRowFor,
    ]
  );

  const noWorkspaceLabel = tCommon(
    "sessions:chat.historyNoWorkspace",
    "No Workspace"
  );

  const byWorkspaceMenuItems = useMemo<NavigationMenuItem[]>(
    () =>
      buildByWorkspaceMenuItems({
        unpinnedSessions,
        repoPathToName,
        noWorkspaceLabel,
        appendPinnedSessions,
        appendGroupSessions,
        appendTrailingLoadMoreItems,
      }),
    [
      unpinnedSessions,
      repoPathToName,
      noWorkspaceLabel,
      appendPinnedSessions,
      appendGroupSessions,
      appendTrailingLoadMoreItems,
    ]
  );

  const noTagsLabel = tCommon("sessions:chat.historyNoTags", "Untagged");

  const byTagsMenuItems = useMemo<NavigationMenuItem[]>(
    () =>
      buildByTagsMenuItems({
        unpinnedSessions,
        noTagsLabel,
        appendPinnedSessions,
        appendGroupSessions,
        appendTrailingLoadMoreItems,
      }),
    [
      unpinnedSessions,
      noTagsLabel,
      appendPinnedSessions,
      appendGroupSessions,
      appendTrailingLoadMoreItems,
    ]
  );

  const menuItems = useMemo<NavigationMenuItem[]>(() => {
    switch (groupByMode) {
      case "byAgent":
        return byAgentMenuItems;
      case "byWorkspace":
        return byWorkspaceMenuItems;
      case "byTags":
        return byTagsMenuItems;
      case "byTime":
      default:
        return byTimeMenuItems;
    }
  }, [
    groupByMode,
    byTimeMenuItems,
    byAgentMenuItems,
    byWorkspaceMenuItems,
    byTagsMenuItems,
  ]);

  return { menuItems, sessionMap, isLoadMoreId, getLoadMoreGroupId };
}
