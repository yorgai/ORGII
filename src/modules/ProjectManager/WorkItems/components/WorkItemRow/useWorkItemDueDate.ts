import { useMemo } from "react";

import { parseApiDate } from "@src/util/data/formatters/date";

import type { DueDateInfo } from "./types";

export function useWorkItemDueDate(endDate: string | undefined): DueDateInfo {
  return useMemo(() => {
    if (!endDate) return { formatted: "", colorClass: "text-text-2" };

    const date = parseApiDate(endDate);
    if (!date) return { formatted: "", colorClass: "text-text-2" };

    const now = new Date();
    const hoursUntil = (date.getTime() - now.getTime()) / (1000 * 60 * 60);
    const isThisYear = date.getFullYear() === now.getFullYear();

    const formatted = isThisYear
      ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : date.toLocaleDateString("en-US", { month: "short", year: "numeric" });

    let colorClass = "text-text-2";
    if (hoursUntil < 24) {
      colorClass = "text-danger-6";
    } else if (hoursUntil < 48) {
      colorClass = "text-warning-6";
    }

    return { formatted, colorClass };
  }, [endDate]);
}
