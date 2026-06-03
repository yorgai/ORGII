import { useAtomValue } from "jotai";
import { GitFork, Loader2, MoreHorizontal } from "lucide-react";
import React, { type ReactNode, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { RUST_AGENT_TYPE } from "@src/api/tauri/agent/types";
import {
  SESSION_GROUP_LABELS,
  SESSION_GROUP_ORDER,
  type SessionGroupKey,
  getSessionGroupKey,
} from "@src/config/sessionAgentGroups";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import {
  type Session,
  type SessionListCategory,
  sessionPaginationAtom,
} from "@src/store/session";
import { isTerminalStatus } from "@src/types/session/session";
import { formatCompactTimeAgo } from "@src/util/data/formatters/date";
import { formatBranchLabel } from "@src/util/git/branchLabel";
import {
  getRustAgentType,
  isCursorIdeSession,
} from "@src/util/session/sessionDispatch";
import { isSessionInProgress } from "@src/util/session/sessionInProgress";
import {
  getSessionListDisplayName,
  resolveSessionRowIcon,
} from "@src/util/session/sessionSidebarRow";
import { isPrimarySessionListSession } from "@src/util/session/sessionVisibility";

import {
  type GroupByMode,
  LOAD_MORE_GROUP_PREFIX,
  LOAD_MORE_PREFIX,
  NO_WORKSPACE_KEY,
} from "./types";

// ============================================
// Date group helpers
// ============================================

const DATE_GROUP_KEYS = ["today", "yesterday", "thisWeek", "older"] as const;
const DEFAULT_GROUP_VISIBLE_COUNT = 10;
type DateGroupKey = (typeof DATE_GROUP_KEYS)[number];

function getDateGroup(session: Session): DateGroupKey {
  const timestamp =
    session.updated_at || session.updated_time || session.created_at;
  if (!timestamp) return "older";

  const date = new Date(timestamp);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const diffMs = startOfToday.getTime() - date.getTime();
  const diffDays = Math.ceil(diffMs / 86_400_000);

  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays <= 7) return "thisWeek";
  return "older";
}

function groupKeyToWireCategory(
  groupKey: SessionGroupKey
): SessionListCategory {
  if (groupKey === "cursor_ide") return "cursor_ide";
  if (groupKey === "cli") return "cli_agent";
  return "rust_agent";
}

// ============================================
// Row building helpers
// ============================================

function separator(id: string, title = ""): NavigationMenuItem {
  return { id: `separator-${id}`, key: `separator-${id}`, label: title };
}

function loadMoreRow(
  category: SessionListCategory,
  loading: boolean,
  label: string
): NavigationMenuItem {
  return {
    id: `${LOAD_MORE_PREFIX}${category}`,
    key: `${LOAD_MORE_PREFIX}${category}`,
    label,
    icon: loading ? undefined : MoreHorizontal,
    iconName: loading ? undefined : "more-horizontal",
    iconElement: loading ? (
      <SpinningLoader size={14} strokeWidth={2} />
    ) : undefined,
    visualTone: "secondary",
    disabled: loading,
  };
}

function groupLoadMoreRow(
  groupId: string,
  label: string,
  loading = false
): NavigationMenuItem {
  return {
    id: `${LOAD_MORE_GROUP_PREFIX}${groupId}`,
    key: `${LOAD_MORE_GROUP_PREFIX}${groupId}`,
    label,
    icon: loading ? undefined : MoreHorizontal,
    iconName: loading ? undefined : "more-horizontal",
    iconElement: loading ? (
      <SpinningLoader size={14} strokeWidth={2} />
    ) : undefined,
    visualTone: "secondary",
    disabled: loading,
  };
}

export function isLoadMoreId(id: string): SessionListCategory | null {
  if (!id.startsWith(LOAD_MORE_PREFIX)) return null;
  const category = id.slice(LOAD_MORE_PREFIX.length) as SessionListCategory;
  if (
    category === "cli_agent" ||
    category === "rust_agent" ||
    category === "cursor_ide"
  ) {
    return category;
  }
  return null;
}

export function getLoadMoreGroupId(id: string): string | null {
  if (!id.startsWith(LOAD_MORE_GROUP_PREFIX)) return null;
  return id.slice(LOAD_MORE_GROUP_PREFIX.length) || null;
}

const SpinningLoader = React.memo(
  (props: { size?: number; strokeWidth?: number; className?: string }) => (
    <Loader2
      size={props.size}
      strokeWidth={props.strokeWidth}
      className={`${props.className ?? ""} animate-spin`}
    />
  )
);
SpinningLoader.displayName = "SpinningLoader";

function renderStatusDot(unread: boolean): ReactNode {
  return (
    <span
      aria-label={unread ? "Unread" : undefined}
      aria-hidden={unread ? undefined : true}
      className={`h-1.5 w-1.5 rounded-full ${unread ? "" : "bg-fill-4"}`}
      style={unread ? { backgroundColor: "#F59E0B" } : undefined}
    />
  );
}

function isSessionCompletedUnread(
  session: Session,
  visitedSessions: ReadonlySet<string>
): boolean {
  if (!isTerminalStatus(session.status)) return false;
  if (session.mergeStatus === "pending") return false;
  return !visitedSessions.has(session.session_id);
}

function worktreeSubtitle(branch: string | undefined): ReactNode {
  const label = formatBranchLabel(branch) || "worktree";
  return (
    <>
      <GitFork size={10} strokeWidth={2} className="shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
}

function shouldShowWorktreeSubtitle(session: Session): boolean {
  return (
    Boolean(session.worktreePath) &&
    getRustAgentType(session.session_id) !== RUST_AGENT_TYPE.TERMINAL
  );
}

// ============================================
// Hook
// ============================================

interface UseSessionMenuItemsParams {
  sortedSessions: Session[];
  visitedSessions: ReadonlySet<string>;
  repoPathToName: Map<string, string>;
  groupByMode: GroupByMode;
  untitledSession: string;
  groupVisibleCounts: ReadonlyMap<string, number>;
}

interface UseSessionMenuItemsResult {
  menuItems: NavigationMenuItem[];
  sessionMap: Map<string, Session>;
  isLoadMoreId: (id: string) => SessionListCategory | null;
  getLoadMoreGroupId: (id: string) => string | null;
}

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

  const visibleSessions = useMemo(
    () => sortedSessions.filter(isPrimarySessionListSession),
    [sortedSessions]
  );

  const sessionMap = useMemo(() => {
    const map = new Map<string, Session>();
    for (const session of visibleSessions) {
      map.set(session.session_id, session);
    }
    return map;
  }, [visibleSessions]);

  const buildSessionRow = useCallback(
    (session: Session): NavigationMenuItem => {
      const inProgress = isSessionInProgress(session.status, session);
      const displayName = getSessionListDisplayName(session, untitledSession);
      const timestampSrc =
        session.updated_at || session.updated_time || session.created_at;
      const unread =
        !inProgress && isSessionCompletedUnread(session, visitedSessions);

      return {
        id: session.session_id,
        key: session.session_id,
        label: displayName,
        dataTestId: `sidebar-session-item-${session.session_id}`,
        subtitle: shouldShowWorktreeSubtitle(session)
          ? worktreeSubtitle(session.worktreeBranch)
          : undefined,
        icon: inProgress
          ? (SpinningLoader as unknown as typeof Loader2)
          : resolveSessionRowIcon(session),
        trailingElement: inProgress ? undefined : renderStatusDot(unread),
        shortcut: formatCompactTimeAgo(timestampSrc),
        showMoreActions: !isCursorIdeSession(session.session_id),
      };
    },
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
    for (const category of [
      "rust_agent",
      "cli_agent",
      "cursor_ide",
    ] as SessionListCategory[]) {
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
      const visibleSessions = groupSessions.slice(0, visibleCount);
      for (const session of visibleSessions) {
        items.push(buildSessionRow(session));
      }
      const hasHiddenSessions = groupSessions.length > visibleSessions.length;
      if (hasHiddenSessions) {
        items.push(
          groupLoadMoreRow(groupId, tCommon("common:actions.loadMore"))
        );
      }
      return hasHiddenSessions;
    },
    [buildSessionRow, groupVisibleCounts, tCommon]
  );

  // ── By date ───────────────────────────────────────────────────────

  const DATE_GROUP_LABELS: Record<DateGroupKey, string> = useMemo(
    () => ({
      today: tCommon("sessions:chat.historyToday", "Today"),
      yesterday: tCommon("sessions:chat.historyYesterday", "Yesterday"),
      thisWeek: tCommon("sessions:chat.historyThisWeek", "This Week"),
      older: tCommon("sessions:chat.historyOlder", "Older"),
    }),
    [tCommon]
  );

  const byTimeMenuItems = useMemo<NavigationMenuItem[]>(() => {
    const groups: Record<DateGroupKey, Session[]> = {
      today: [],
      yesterday: [],
      thisWeek: [],
      older: [],
    };
    for (const session of visibleSessions) {
      groups[getDateGroup(session)].push(session);
    }

    const items: NavigationMenuItem[] = [];
    let hasHiddenLocalSessions = false;
    for (const groupKey of DATE_GROUP_KEYS) {
      const groupSessions = groups[groupKey];
      if (groupSessions.length === 0) continue;
      items.push(separator(groupKey, DATE_GROUP_LABELS[groupKey]));
      hasHiddenLocalSessions =
        appendGroupSessions(items, `time:${groupKey}`, groupSessions) ||
        hasHiddenLocalSessions;
    }
    if (!hasHiddenLocalSessions) {
      appendTrailingLoadMoreItems(items);
    }
    return items;
  }, [
    visibleSessions,
    DATE_GROUP_LABELS,
    appendGroupSessions,
    appendTrailingLoadMoreItems,
  ]);

  // ── By agent type ─────────────────────────────────────────────────

  const byAgentMenuItems = useMemo<NavigationMenuItem[]>(() => {
    const groups = new Map<SessionGroupKey, Session[]>();
    const agentOrgGroups = new Map<string, Session[]>();

    for (const session of visibleSessions) {
      if (session.agentOrgId) {
        const bucket = agentOrgGroups.get(session.agentOrgId);
        if (bucket) {
          bucket.push(session);
        } else {
          agentOrgGroups.set(session.agentOrgId, [session]);
        }
        continue;
      }

      const key = getSessionGroupKey(session.session_id);
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(session);
      } else {
        groups.set(key, [session]);
      }
    }

    const items: NavigationMenuItem[] = [];
    const loadMoreEmitted = new Set<SessionListCategory>();
    const sortedAgentOrgGroups = Array.from(agentOrgGroups.entries()).sort(
      ([orgIdA, sessionsA], [orgIdB, sessionsB]) => {
        const labelA = sessionsA[0]?.agentOrgName ?? orgIdA;
        const labelB = sessionsB[0]?.agentOrgName ?? orgIdB;
        return labelA.localeCompare(labelB);
      }
    );

    for (const [orgId, groupSessions] of sortedAgentOrgGroups) {
      const label = groupSessions[0]?.agentOrgName ?? orgId;
      items.push(separator(`agent-org:${orgId}`, label));
      const hasHiddenOrgSessions = appendGroupSessions(
        items,
        `agent-org:${orgId}`,
        groupSessions
      );
      // If the Agent Org group already has a local "Load more" row,
      // suppress the backend "Load more" for the same wire category
      // (rust_agent) so we never render two Load more rows for the
      // same category at once.
      if (hasHiddenOrgSessions) {
        loadMoreEmitted.add("rust_agent");
      }
    }

    for (const key of SESSION_GROUP_ORDER) {
      const groupSessions = groups.get(key);
      if (!groupSessions || groupSessions.length === 0) continue;
      items.push(separator(key, SESSION_GROUP_LABELS[key]));
      const hasHiddenLocalSessions = appendGroupSessions(
        items,
        `agent:${key}`,
        groupSessions
      );
      const wireCategory = groupKeyToWireCategory(key);
      if (!hasHiddenLocalSessions && !loadMoreEmitted.has(wireCategory)) {
        const row = loadMoreRowFor(wireCategory);
        if (row) {
          items.push(row);
          loadMoreEmitted.add(wireCategory);
        }
      }
    }
    return items;
  }, [visibleSessions, appendGroupSessions, loadMoreRowFor]);

  // ── By workspace ──────────────────────────────────────────────────

  const noWorkspaceLabel = tCommon(
    "sessions:chat.historyNoWorkspace",
    "No Workspace"
  );

  const byWorkspaceMenuItems = useMemo<NavigationMenuItem[]>(() => {
    const groups = new Map<string, Session[]>();
    for (const session of visibleSessions) {
      const rawPath = session.repoPath?.replace(/\/+$/, "") ?? "";
      const key = rawPath || NO_WORKSPACE_KEY;
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(session);
      } else {
        groups.set(key, [session]);
      }
    }

    const orderedKeys = Array.from(groups.keys()).sort((keyA, keyB) => {
      if (keyA === NO_WORKSPACE_KEY) return 1;
      if (keyB === NO_WORKSPACE_KEY) return -1;
      const labelA = repoPathToName.get(keyA) ?? keyA.split("/").pop() ?? keyA;
      const labelB = repoPathToName.get(keyB) ?? keyB.split("/").pop() ?? keyB;
      return labelA.localeCompare(labelB);
    });

    const items: NavigationMenuItem[] = [];
    let hasHiddenLocalSessions = false;
    for (const key of orderedKeys) {
      const groupSessions = groups.get(key);
      if (!groupSessions || groupSessions.length === 0) continue;
      const label =
        key === NO_WORKSPACE_KEY
          ? noWorkspaceLabel
          : (repoPathToName.get(key) ?? key.split("/").pop() ?? key);
      items.push(separator(key, label));
      hasHiddenLocalSessions =
        appendGroupSessions(items, `workspace:${key}`, groupSessions) ||
        hasHiddenLocalSessions;
    }
    if (!hasHiddenLocalSessions) {
      appendTrailingLoadMoreItems(items);
    }
    return items;
  }, [
    visibleSessions,
    repoPathToName,
    noWorkspaceLabel,
    appendGroupSessions,
    appendTrailingLoadMoreItems,
  ]);

  // ── By tags ───────────────────────────────────────────────────────

  const noTagsLabel = tCommon("sessions:chat.historyNoTags", "Untagged");
  const pinnedLabel = tCommon("sessions:chat.historyPinned", "Pinned");

  const byTagsMenuItems = useMemo<NavigationMenuItem[]>(() => {
    const tagGroups = new Map<string, Session[]>();
    const pinnedSessions: Session[] = [];
    const untaggedSessions: Session[] = [];

    for (const session of visibleSessions) {
      if (session.pinned) {
        pinnedSessions.push(session);
      }
      const sessionTags = session.tags ?? [];
      if (sessionTags.length === 0) {
        untaggedSessions.push(session);
      } else {
        for (const tag of sessionTags) {
          const bucket = tagGroups.get(tag);
          if (bucket) {
            bucket.push(session);
          } else {
            tagGroups.set(tag, [session]);
          }
        }
      }
    }

    const items: NavigationMenuItem[] = [];
    let hasHiddenLocalSessions = false;

    if (pinnedSessions.length > 0) {
      items.push(separator("pinned", pinnedLabel));
      hasHiddenLocalSessions =
        appendGroupSessions(items, "tags:pinned", pinnedSessions) ||
        hasHiddenLocalSessions;
    }

    const sortedTags = Array.from(tagGroups.keys()).sort((tagA, tagB) =>
      tagA.localeCompare(tagB)
    );
    for (const tag of sortedTags) {
      const groupSessions = tagGroups.get(tag);
      if (!groupSessions || groupSessions.length === 0) continue;
      items.push(separator(`tag:${tag}`, `#${tag}`));
      hasHiddenLocalSessions =
        appendGroupSessions(items, `tags:tag:${tag}`, groupSessions) ||
        hasHiddenLocalSessions;
    }

    if (untaggedSessions.length > 0) {
      items.push(separator("untagged", noTagsLabel));
      hasHiddenLocalSessions =
        appendGroupSessions(items, "tags:untagged", untaggedSessions) ||
        hasHiddenLocalSessions;
    }

    if (!hasHiddenLocalSessions) {
      appendTrailingLoadMoreItems(items);
    }
    return items;
  }, [
    visibleSessions,
    appendGroupSessions,
    appendTrailingLoadMoreItems,
    noTagsLabel,
    pinnedLabel,
  ]);

  // ── Active menu ───────────────────────────────────────────────────

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
