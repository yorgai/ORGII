import type { Session } from "@src/store/session";

export const DATE_GROUP_KEYS = [
  "today",
  "yesterday",
  "thisWeek",
  "older",
] as const;
export const DEFAULT_GROUP_VISIBLE_COUNT = 10;

export type DateGroupKey = (typeof DATE_GROUP_KEYS)[number];

export function getDateGroup(session: Session): DateGroupKey {
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
