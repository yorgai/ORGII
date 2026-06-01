import type { DueDateInfo } from "./types";

export function deriveDisplayId(
  storedId: string,
  currentPrefix: string
): string {
  const dashIndex = storedId.lastIndexOf("-");
  if (dashIndex === -1) return storedId;
  const numericPart = storedId.slice(dashIndex + 1);
  return `${currentPrefix}-${numericPart}`;
}

export function getDueDateColorClass(
  status: string,
  dateInfo: DueDateInfo
): string {
  return status === "completed" ? "text-text-3" : dateInfo.colorClass;
}
