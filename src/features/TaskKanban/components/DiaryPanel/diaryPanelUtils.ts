/**
 * Pure utility functions for DiaryPanel data transformations.
 * Extracted to keep DiaryPanel/index.tsx under the 600-line limit.
 */
import type {
  GanttMarkerRow,
  GanttTask,
  GanttViewScope,
} from "@src/features/GanttChart";
import { formatDuration } from "@src/util/time/formatDuration";

import type {
  DiaryCommitMarker,
  DiaryDaySummary,
  DiaryEventKind,
} from "../../utils/diaryUtils";
import { DIARY_EVENT_KIND } from "../../utils/diaryUtils";

// ============================================================================
// Constants
// ============================================================================

export const DIARY_GANTT_MIN_LABEL_DURATION_MS = 60 * 60 * 1000;
export const DIARY_COMMIT_ROW_ID = "diary-commits";
export const DIARY_COMMIT_MARKER_COLOR = "var(--color-primary-6)";
export const COMMIT_BUCKET_HALF_HOUR_MS = 30 * 60 * 1000;
export const COMMIT_BUCKET_MARKER_ID_PREFIX = "diary-commit-half-hour";

// ============================================================================
// Formatting helpers
// ============================================================================

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// ============================================================================
// Gantt header label / emphasis
// ============================================================================

export function formatDiaryGanttHeaderLabel(
  date: Date,
  viewScope: GanttViewScope
): string {
  if (viewScope !== "1d") return "";
  const hour = date.getHours();
  if (hour === 0) return "";
  const hour12 = hour % 12 || 12;
  const meridiem = hour < 12 ? "AM" : "PM";
  return `${hour12}${meridiem}`;
}

export function isDiaryGanttHeaderEmphasized(
  date: Date,
  viewScope: GanttViewScope
): boolean {
  return viewScope === "1d" && date.getHours() % 4 === 0;
}

// ============================================================================
// Interval / task helpers
// ============================================================================

export function getGanttTaskStatus(
  eventKind: DiaryEventKind | undefined
): GanttTask["status"] {
  if (eventKind === DIARY_EVENT_KIND.Completed) return "completed";
  return "in_progress";
}

function compareDiaryIntervals(
  firstInterval: DiaryDaySummary["workIntervals"][number],
  secondInterval: DiaryDaySummary["workIntervals"][number]
): number {
  const startDiff =
    firstInterval.start.getTime() - secondInterval.start.getTime();
  if (startDiff !== 0) return startDiff;

  const endDiff = firstInterval.end.getTime() - secondInterval.end.getTime();
  if (endDiff !== 0) return endDiff;

  const titleDiff = firstInterval.task.title.localeCompare(
    secondInterval.task.title
  );
  if (titleDiff !== 0) return titleDiff;

  return firstInterval.id.localeCompare(secondInterval.id);
}

export function getDiaryGanttRowId(
  interval: DiaryDaySummary["workIntervals"][number]
): string {
  return interval.task.session_id ?? interval.task.id;
}

// ============================================================================
// Commit bucket helpers
// ============================================================================

export function getCommitBucketStart(timestamp: Date): Date {
  const bucketMinutes = timestamp.getMinutes() >= 30 ? 30 : 0;
  return new Date(
    timestamp.getFullYear(),
    timestamp.getMonth(),
    timestamp.getDate(),
    timestamp.getHours(),
    bucketMinutes,
    0,
    0
  );
}

export function getCommitBucketEnd(bucketStart: Date): Date {
  return new Date(bucketStart.getTime() + COMMIT_BUCKET_HALF_HOUR_MS);
}

export function getCommitBucketId(bucketStart: Date): string {
  return `${COMMIT_BUCKET_MARKER_ID_PREFIX}-${bucketStart.getTime()}`;
}

export function getCommitBucketRangeLabel(bucketStart: Date): string {
  return `${formatTime(bucketStart)}–${formatTime(getCommitBucketEnd(bucketStart))}`;
}

export function groupCommitsByHalfHour(
  commits: DiaryCommitMarker[]
): DiaryCommitMarker[][] {
  const commitsByBucket = new Map<number, DiaryCommitMarker[]>();
  for (const commitMarker of commits) {
    const bucketStart = getCommitBucketStart(commitMarker.timestamp);
    const existingMarkers = commitsByBucket.get(bucketStart.getTime()) ?? [];
    existingMarkers.push(commitMarker);
    commitsByBucket.set(bucketStart.getTime(), existingMarkers);
  }

  return Array.from(commitsByBucket.entries())
    .sort(([firstBucket], [secondBucket]) => firstBucket - secondBucket)
    .map(([, bucketCommits]) =>
      bucketCommits.sort(
        (firstCommit, secondCommit) =>
          firstCommit.timestamp.getTime() - secondCommit.timestamp.getTime()
      )
    );
}

export function getCommitBucketByMarkerId(
  summary: DiaryDaySummary,
  markerId: string
): DiaryCommitMarker[] {
  return (
    groupCommitsByHalfHour(summary.commits).find((bucketCommits) => {
      const bucketStart = getCommitBucketStart(bucketCommits[0].timestamp);
      return getCommitBucketId(bucketStart) === markerId;
    }) ?? []
  );
}

// ============================================================================
// Gantt task / marker builders
// ============================================================================

export function buildDiaryCommitMarkerRows(
  summary: DiaryDaySummary,
  rowTitle: string
): GanttMarkerRow[] {
  if (summary.commits.length === 0) return [];

  const commitBuckets = groupCommitsByHalfHour(summary.commits);

  return [
    {
      id: DIARY_COMMIT_ROW_ID,
      title: rowTitle,
      badgeLabel: String(summary.commits.length),
      markers: commitBuckets.map((bucketCommits) => {
        const bucketStart = getCommitBucketStart(bucketCommits[0].timestamp);
        const bucketEnd = getCommitBucketEnd(bucketStart);
        const bucketLabel = String(bucketCommits.length);

        return {
          id: getCommitBucketId(bucketStart),
          title: getCommitBucketRangeLabel(bucketStart),
          timestamp: bucketStart,
          endTimestamp: bucketEnd,
          label: bucketLabel,
          color: DIARY_COMMIT_MARKER_COLOR,
          ariaLabel: `${bucketLabel} commits ${getCommitBucketRangeLabel(bucketStart)}`,
        };
      }),
    },
  ];
}

export function buildDiaryGanttTasks(summary: DiaryDaySummary): GanttTask[] {
  const intervalsByRow = new Map<
    string,
    DiaryDaySummary["workIntervals"][number][]
  >();

  for (const interval of summary.workIntervals) {
    const rowId = getDiaryGanttRowId(interval);
    const existingIntervals = intervalsByRow.get(rowId) ?? [];
    existingIntervals.push(interval);
    intervalsByRow.set(rowId, existingIntervals);
  }

  return Array.from(intervalsByRow.entries())
    .map(([rowId, intervals], originalIndex) => {
      const sortedIntervals = [...intervals].sort(compareDiaryIntervals);
      const firstInterval = sortedIntervals[0];
      const lastInterval = sortedIntervals[sortedIntervals.length - 1];
      const completionEvent = summary.events.find(
        (event) =>
          event.task.id === firstInterval.task.id &&
          event.kind !== DIARY_EVENT_KIND.Started
      );
      const segments = sortedIntervals.map((interval) => {
        const durationMs = Math.max(
          0,
          interval.end.getTime() - interval.start.getTime()
        );
        return {
          id: interval.id,
          startDate: interval.start,
          endDate: interval.end,
          barLabel:
            durationMs >= DIARY_GANTT_MIN_LABEL_DURATION_MS
              ? formatDuration(durationMs)
              : undefined,
          startClipped: interval.startsBeforeDay,
          endClipped: interval.endsAfterDay,
        };
      });

      return {
        originalIndex,
        task: {
          id: rowId,
          title: firstInterval.task.title,
          startDate: firstInterval.start,
          endDate: lastInterval.end,
          status: getGanttTaskStatus(completionEvent?.kind),
          assignee: firstInterval.task.agentLabel,
          progress:
            completionEvent?.kind === DIARY_EVENT_KIND.Completed ? 100 : 50,
          sessionId: firstInterval.task.session_id,
          agentIconId: firstInterval.task.agentIconId,
          cliAgentType: firstInterval.task.cliAgentType,
          segments,
        },
      };
    })
    .sort((firstEntry, secondEntry) => {
      const startDiff =
        new Date(firstEntry.task.startDate).getTime() -
        new Date(secondEntry.task.startDate).getTime();
      if (startDiff !== 0) return startDiff;
      return firstEntry.originalIndex - secondEntry.originalIndex;
    })
    .map((entry) => entry.task);
}
