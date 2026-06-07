import { MoreHorizontal } from "lucide-react";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { Session, SessionListCategory } from "@src/store/session";

import { LOAD_MORE_GROUP_PREFIX, LOAD_MORE_PREFIX } from "../types";
import { DEFAULT_GROUP_VISIBLE_COUNT } from "./dateGroupingHelpers";
import { renderBreathingStatusDot } from "./statusIndicators";
import type { BuildSessionRow } from "./types";

export const LOAD_MORE_CATEGORIES: readonly SessionListCategory[] = [
  "rust_agent",
  "cli_agent",
  "cursor_ide",
];

export function loadMoreRow(
  category: SessionListCategory,
  loading: boolean,
  label: string
): NavigationMenuItem {
  return {
    id: `${LOAD_MORE_PREFIX}${category}`,
    key: `${LOAD_MORE_PREFIX}${category}`,
    label,
    icon: MoreHorizontal,
    iconName: "more-horizontal",
    trailingElement: loading ? renderBreathingStatusDot() : undefined,
    visualTone: "secondary",
    disabled: loading,
  };
}

export function groupLoadMoreRow(
  groupId: string,
  label: string,
  loading = false
): NavigationMenuItem {
  return {
    id: `${LOAD_MORE_GROUP_PREFIX}${groupId}`,
    key: `${LOAD_MORE_GROUP_PREFIX}${groupId}`,
    label,
    icon: MoreHorizontal,
    iconName: "more-horizontal",
    trailingElement: loading ? renderBreathingStatusDot() : undefined,
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

interface AppendSessionGroupParams {
  items: NavigationMenuItem[];
  groupId: string;
  groupSessions: readonly Session[];
  visibleCount?: number;
  buildSessionRow: BuildSessionRow;
  loadMoreLabel: string;
}

export function appendSessionGroup({
  items,
  groupId,
  groupSessions,
  visibleCount = DEFAULT_GROUP_VISIBLE_COUNT,
  buildSessionRow,
  loadMoreLabel,
}: AppendSessionGroupParams): boolean {
  const visibleSessions = groupSessions.slice(0, visibleCount);
  for (const session of visibleSessions) {
    items.push(buildSessionRow(session));
  }
  const hasHiddenSessions = groupSessions.length > visibleSessions.length;
  if (hasHiddenSessions) {
    items.push(groupLoadMoreRow(groupId, loadMoreLabel));
  }
  return hasHiddenSessions;
}
