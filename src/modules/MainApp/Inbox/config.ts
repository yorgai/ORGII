/**
 * Inbox Configuration
 *
 * Configuration for inbox channels (message grouping) and date formatting.
 */
import { Diff, ListTodo, type LucideIcon, Store } from "lucide-react";

// ============================================
// Channels
// ============================================

import type { InboxCategory } from "@src/api/types/inbox";

export type { InboxCategory };

export interface InboxChannelConfig {
  id: InboxCategory;
  labelKey: string;
  icon: LucideIcon;
  color: string;
}

export const INBOX_CHANNELS: InboxChannelConfig[] = [
  {
    id: "git",
    labelKey: "inbox.channels.git",
    icon: Diff,
    color: "#f97316",
  },
  {
    id: "workitems",
    labelKey: "inbox.channels.workItems",
    icon: ListTodo,
    color: "#3b82f6",
  },
  {
    id: "promotion",
    labelKey: "inbox.channels.promotions",
    icon: Store,
    color: "#8b5cf6",
  },
];

export const DEFAULT_INBOX_CHANNEL: InboxCategory = INBOX_CHANNELS[0].id;

export function getChannelConfig(
  channelId: InboxCategory
): InboxChannelConfig | undefined {
  return INBOX_CHANNELS.find((ch) => ch.id === channelId);
}

export function getCategoryChannelConfig(
  category: InboxCategory
): InboxChannelConfig | undefined {
  return INBOX_CHANNELS.find((ch) => ch.id === category);
}

// ============================================
// Date formatting
// ============================================

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface InboxDateParts {
  /** The main date/time string — rendered bold */
  time: string;
  /** Optional relative suffix like "(5m ago)" — rendered normal weight */
  suffix?: string;
}

/**
 * Format a date for inbox display (structured):
 * - Today → time: "2:30 PM", suffix: "(5m ago)"
 * - Yesterday → time: "Yesterday, 2:30 PM"
 * - 2–6 days ago → time: "Mon, 2:30 PM"
 * - 7+ days, same year → time: "Feb 25, 2:30 PM"
 * - Different year → time: "Feb 25, 2025, 2:30 PM"
 */
export function formatInboxDate(iso: string): InboxDateParts {
  const date = new Date(iso);
  const now = new Date();

  const clock = date.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000
  );

  if (dayDiff === 0) {
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);

    let ago: string;
    if (diffSec < 60) ago = "just now";
    else if (diffMin < 60) ago = `${diffMin}m ago`;
    else ago = `${diffHr}h ago`;

    return { time: clock, suffix: `(${ago})` };
  }
  if (dayDiff === 1) return { time: `Yesterday, ${clock}` };
  if (dayDiff >= 2 && dayDiff <= 6)
    return { time: `${DAY_NAMES[date.getDay()]}, ${clock}` };

  const month = date.toLocaleString("en-US", { month: "short" });
  const day = date.getDate();
  if (date.getFullYear() === now.getFullYear())
    return { time: `${month} ${day}, ${clock}` };
  return { time: `${month} ${day}, ${date.getFullYear()}, ${clock}` };
}

/** Returns true if the ISO date is from today (needs live updates). */
export function isToday(iso: string): boolean {
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/**
 * Compact date for feed message timestamps:
 * - Today → "5m ago" / "2h ago" / "just now"
 * - Yesterday → "Yesterday"
 * - 2–6 days ago → "2d ago"
 * - 7+ days, same year → "Feb 25"
 * - Different year → "Feb 25, 2025"
 */
export function formatInboxDateCompact(iso: string): string {
  const date = new Date(iso);
  const now = new Date();

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000
  );

  if (dayDiff === 0) {
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    if (diffSec < 60) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    return `${diffHr}h ago`;
  }
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff >= 2 && dayDiff <= 6) return `${dayDiff}d ago`;

  const month = date.toLocaleString("en-US", { month: "short" });
  const day = date.getDate();
  if (date.getFullYear() === now.getFullYear()) return `${month} ${day}`;
  return `${month} ${day}, ${date.getFullYear()}`;
}

/**
 * Returns a date group label for feed date separators.
 * - Today → "Today"
 * - Yesterday → "Yesterday"
 * - Same year → "Mon, Feb 25"
 * - Different year → "Mon, Feb 25, 2025"
 */
export function formatDateGroupLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000
  );

  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";

  const dayName = DAY_NAMES[date.getDay()];
  const month = date.toLocaleString("en-US", { month: "short" });
  const day = date.getDate();
  if (date.getFullYear() === now.getFullYear())
    return `${dayName}, ${month} ${day}`;
  return `${dayName}, ${month} ${day}, ${date.getFullYear()}`;
}

/** Returns a calendar-day key (YYYY-MM-DD) for grouping messages by date. */
export function getDateKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
