/**
 * Format a commit date string into an activity label.
 *
 * Returns "Active" when the last commit is within 7 days,
 * otherwise returns the date string (YYYY-MM-DD).
 *
 * Shared between RepoMembersSection and MyProfileSection.
 */
import type { TFunction } from "i18next";

const ACTIVE_THRESHOLD_DAYS = 7;

export function formatLastCommitDate(dateStr: string, t: TFunction): string {
  const commitDate = new Date(dateStr);
  if (isNaN(commitDate.getTime())) return dateStr;

  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - commitDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays >= 0 && diffDays <= ACTIVE_THRESHOLD_DAYS) {
    return t("settings.memberRecentlyActive");
  }
  return dateStr;
}
