/**
 * Data aggregation functions for the Git Dashboard.
 *
 * Pure functions that transform raw GitCommitInfo[] into chart data,
 * contributor stats, and dot graph cell grids.
 */
import type { GitCommitInfo } from "@src/api/http/git/types";

import { DAY_LABELS, HOUR_LABELS } from "./config";
import type {
  ChangeMetrics,
  CommitStatsEntry,
  ContributorStats,
  DailyCommitData,
  DotGraphCell,
} from "./types";

// ============================================
// Date Formatters
// ============================================

export function formatHourKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:00`;
}

export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeLabel(dateKey: string): string {
  const [, timePart] = dateKey.split(" ");
  const [hourStr] = timePart.split(":");
  const hour = parseInt(hourStr, 10);
  const ampm = hour >= 12 ? "pm" : "am";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}${ampm}`;
}

function formatDayLabel(dateKey: string): string {
  const [datePart] = dateKey.split(" ");
  const [, month, day] = datePart.split("-");
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  return `${m}/${d}`;
}

function formatDateLabel(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${parseInt(month, 10)}/${parseInt(day, 10)}`;
}

// ============================================
// Bar Chart Data
// ============================================

export function buildChartData(
  commits: GitCommitInfo[],
  days: number
): { chartData: DailyCommitData[]; authors: string[] } {
  const now = new Date();
  const authorSet = new Set<string>();
  const isHourly = days <= 3;

  const bucketMap = new Map<string, Map<string, number>>();

  if (isHourly) {
    const nowMs = now.getTime();
    const hours = days * 24;
    for (let h = hours - 1; h >= 0; h--) {
      const date = new Date(nowMs - h * 3600000);
      date.setMinutes(0, 0, 0);
      bucketMap.set(formatHourKey(date), new Map());
    }
  } else {
    for (let dayOffset = days - 1; dayOffset >= 0; dayOffset--) {
      const date = new Date(now);
      date.setDate(date.getDate() - dayOffset);
      bucketMap.set(formatDateKey(date), new Map());
    }
  }

  for (const commit of commits) {
    const authorDate = commit.author?.date;
    if (!authorDate) continue;

    const date = new Date(authorDate);
    const key = isHourly ? formatHourKey(date) : formatDateKey(date);
    const authorName = commit.author?.name ?? "Unknown";
    authorSet.add(authorName);

    const bucket = bucketMap.get(key);
    if (bucket) {
      bucket.set(authorName, (bucket.get(authorName) ?? 0) + 1);
    }
  }

  const authors = Array.from(authorSet).sort();
  const chartData: DailyCommitData[] = [];

  for (const [dateKey, authorMap] of bucketMap) {
    const isMidnight = isHourly && dateKey.endsWith(" 00:00");
    const row: DailyCommitData = {
      date: isHourly ? formatTimeLabel(dateKey) : formatDateLabel(dateKey),
      ...(isMidnight && days > 1 ? { dayLabel: formatDayLabel(dateKey) } : {}),
      total: 0,
    };
    for (const author of authors) {
      const count = authorMap.get(author) ?? 0;
      row[author] = count;
      row.total += count;
    }
    chartData.push(row);
  }

  return { chartData, authors };
}

// ============================================
// Contributor Stats
// ============================================

const RENAME_STATUS = "renamed";

function metricsFromStat(stat: CommitStatsEntry): {
  all: ChangeMetrics;
  contentOnly: ChangeMetrics;
} {
  const all: ChangeMetrics = {
    filesChanged: stat.filesChanged,
    additions: stat.insertions,
    deletions: stat.deletions,
  };

  if (stat.fileChanges.length === 0) {
    return { all, contentOnly: { ...all } };
  }

  let coFiles = 0;
  let coAdd = 0;
  let coDel = 0;
  for (const file of stat.fileChanges) {
    if (file.status !== RENAME_STATUS) {
      coFiles++;
      coAdd += file.insertions;
      coDel += file.deletions;
    }
  }

  return {
    all,
    contentOnly: { filesChanged: coFiles, additions: coAdd, deletions: coDel },
  };
}

export function buildContributorStats(
  commits: GitCommitInfo[],
  statsMap: Map<string, CommitStatsEntry>
): ContributorStats[] {
  const aggMap = new Map<
    string,
    {
      name: string;
      email: string;
      count: number;
      lastDate: string;
      all: ChangeMetrics;
      contentOnly: ChangeMetrics;
    }
  >();

  for (const commit of commits) {
    const name = commit.author?.name ?? "Unknown";
    const email = commit.author?.email ?? "";
    const date = commit.author?.date ?? "";
    const stat = statsMap.get(commit.sha);

    const existing = aggMap.get(name);
    if (existing) {
      existing.count += 1;
      if (date > existing.lastDate) {
        existing.lastDate = date;
      }
      if (stat) {
        const { all, contentOnly } = metricsFromStat(stat);
        existing.all.filesChanged += all.filesChanged;
        existing.all.additions += all.additions;
        existing.all.deletions += all.deletions;
        existing.contentOnly.filesChanged += contentOnly.filesChanged;
        existing.contentOnly.additions += contentOnly.additions;
        existing.contentOnly.deletions += contentOnly.deletions;
      }
    } else {
      const metrics = stat
        ? metricsFromStat(stat)
        : {
            all: { filesChanged: 0, additions: 0, deletions: 0 },
            contentOnly: { filesChanged: 0, additions: 0, deletions: 0 },
          };
      aggMap.set(name, {
        name,
        email,
        count: 1,
        lastDate: date,
        all: metrics.all,
        contentOnly: metrics.contentOnly,
      });
    }
  }

  return Array.from(aggMap.values())
    .map((entry) => ({
      name: entry.name,
      email: entry.email,
      commitCount: entry.count,
      all: entry.all,
      contentOnly: entry.contentOnly,
      lastCommitDate: entry.lastDate,
    }))
    .sort((entryA, entryB) => entryB.commitCount - entryA.commitCount);
}

export function buildTeamStats(statsMap: Map<string, CommitStatsEntry>): {
  all: ChangeMetrics;
  contentOnly: ChangeMetrics;
} {
  const all: ChangeMetrics = { filesChanged: 0, additions: 0, deletions: 0 };
  const contentOnly: ChangeMetrics = {
    filesChanged: 0,
    additions: 0,
    deletions: 0,
  };

  for (const stat of statsMap.values()) {
    const metrics = metricsFromStat(stat);
    all.filesChanged += metrics.all.filesChanged;
    all.additions += metrics.all.additions;
    all.deletions += metrics.all.deletions;
    contentOnly.filesChanged += metrics.contentOnly.filesChanged;
    contentOnly.additions += metrics.contentOnly.additions;
    contentOnly.deletions += metrics.contentOnly.deletions;
  }

  return { all, contentOnly };
}

// ============================================
// Dot Graph Data
// ============================================

export interface DotGraphDataResult {
  cells: DotGraphCell[];
  maxCount: number;
  xCount: number;
  yCount: number;
  xLabels: { label: string; index: number }[];
  yLabels: { label: string; index: number }[];
  isHourly: boolean;
  cellIndex: Map<string, DotGraphCell>;
}

export function buildDotGraphData(
  commits: GitCommitInfo[],
  days: number
): DotGraphDataResult {
  const now = new Date();
  const isHourly = days <= 3;
  const counts = new Map<string, number>();

  for (const commit of commits) {
    const authorDate = commit.author?.date;
    if (!authorDate) continue;
    const date = new Date(authorDate);
    const key = isHourly ? formatHourKey(date) : formatDateKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const cells: DotGraphCell[] = [];
  const cellIndex = new Map<string, DotGraphCell>();
  const xLabels: { label: string; index: number }[] = [];
  const yLabels: { label: string; index: number }[] = [];
  let maxCount = 0;
  let xCount = 0;
  let yCount = 0;

  if (isHourly) {
    xCount = 24;
    yCount = days;

    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const date = new Date(now);
      date.setDate(date.getDate() - (days - 1 - dayOffset));
      const isToday = date.toDateString() === now.toDateString();
      const label = isToday
        ? "Today"
        : date.toLocaleString("default", { weekday: "short" });
      yLabels.push({ label, index: dayOffset });
    }

    for (let i = 0; i < 6; i++) {
      xLabels.push({ label: HOUR_LABELS[i], index: i * 4 });
    }

    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const date = new Date(now);
      date.setDate(date.getDate() - (days - 1 - dayOffset));

      for (let hour = 0; hour < 24; hour++) {
        date.setHours(hour, 0, 0, 0);
        const key = formatHourKey(date);
        const count = counts.get(key) ?? 0;
        if (count > maxCount) maxCount = count;

        const cell: DotGraphCell = {
          dateKey: key,
          count,
          xIndex: hour,
          yIndex: dayOffset,
        };
        cells.push(cell);
        cellIndex.set(`${hour}-${dayOffset}`, cell);
      }
    }
  } else {
    yCount = 7;
    const endDate = new Date(now);
    endDate.setHours(0, 0, 0, 0);

    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days + 1);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    const cursor = new Date(startDate);
    let weekIndex = 0;
    let lastMonth = -1;

    yLabels.push(
      { label: DAY_LABELS[1], index: 1 },
      { label: DAY_LABELS[3], index: 3 },
      { label: DAY_LABELS[5], index: 5 }
    );

    while (cursor <= endDate) {
      const dayOfWeek = cursor.getDay();
      const key = formatDateKey(cursor);
      const count = counts.get(key) ?? 0;
      if (count > maxCount) maxCount = count;

      const cell: DotGraphCell = {
        dateKey: key,
        count,
        xIndex: weekIndex,
        yIndex: dayOfWeek,
      };
      cells.push(cell);
      cellIndex.set(`${weekIndex}-${dayOfWeek}`, cell);

      if (dayOfWeek === 0) {
        const currentMonth = cursor.getMonth();
        if (currentMonth !== lastMonth) {
          xLabels.push({
            label: cursor.toLocaleString("default", { month: "short" }),
            index: weekIndex,
          });
          lastMonth = currentMonth;
        }
      }

      cursor.setDate(cursor.getDate() + 1);
      if (cursor.getDay() === 0 && cursor <= endDate) {
        weekIndex++;
      }
    }

    xCount = weekIndex + 1;
  }

  return {
    cells,
    maxCount,
    xCount,
    yCount,
    xLabels,
    yLabels,
    isHourly,
    cellIndex,
  };
}
