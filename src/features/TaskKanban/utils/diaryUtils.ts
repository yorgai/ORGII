import type { GitCommitInfo } from "@src/api/http/git/types";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import type { KanbanTask } from "@src/features/KanbanBoard/types";
import { parseApiDate } from "@src/util/data/formatters/dateCore";

export const DIARY_EVENT_KIND = {
  Started: "started",
  Completed: "completed",
  StillWorking: "still_working",
} as const;

export type DiaryEventKind =
  (typeof DIARY_EVENT_KIND)[keyof typeof DIARY_EVENT_KIND];

export interface DiaryTimelineEvent {
  id: string;
  kind: DiaryEventKind;
  timestamp: Date;
  task: KanbanTask;
}

export interface DiaryCommitMarker {
  id: string;
  commit: GitCommitInfo;
  timestamp: Date;
  task: KanbanTask | undefined;
  sessionId: string | undefined;
}

export interface DiaryWorkInterval {
  id: string;
  task: KanbanTask;
  start: Date;
  end: Date;
  startsBeforeDay: boolean;
  endsAfterDay: boolean;
}

export interface DiaryDaySummary {
  dayStart: Date;
  engineeringMinutes: number;
  onlineMinutes: number;
  activeSessions: number;
  completedSessions: number;
  events: DiaryTimelineEvent[];
  workIntervals: DiaryWorkInterval[];
  commits: DiaryCommitMarker[];
}

interface WorkInterval {
  startMs: number;
  endMs: number;
}

const MIN_TERMINAL_WORK_MS = 30 * 60 * 1000;
const ROUND_INTERVAL_MERGE_GAP_MS = 10 * 60 * 1000;

function getStartOfLocalDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0
  );
}

function getEndOfLocalDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999
  );
}

function isTerminalTask(task: KanbanTask): boolean {
  const status = task.status as string;
  return (
    status === "finished" ||
    status === "done" ||
    status === "cancelled" ||
    task.resultStatus !== undefined
  );
}

function getTaskEnd(task: KanbanTask, start: Date, now: Date): Date {
  const terminal = isTerminalTask(task);
  const source = terminal
    ? (task.completed_at ?? task.updated_at ?? task.created_at)
    : now.toISOString();
  const parsedEnd = parseApiDate(source ?? now.toISOString()) ?? now;
  const cappedEnd = parsedEnd.getTime() > now.getTime() ? now : parsedEnd;

  if (cappedEnd.getTime() > start.getTime()) return cappedEnd;

  if (terminal && now.getTime() > start.getTime()) {
    return new Date(
      Math.min(start.getTime() + MIN_TERMINAL_WORK_MS, now.getTime())
    );
  }

  return start;
}

function overlapsDay(
  start: Date,
  end: Date,
  dayStart: Date,
  dayEnd: Date
): boolean {
  return (
    start.getTime() <= dayEnd.getTime() && end.getTime() >= dayStart.getTime()
  );
}

function pushEventIfInDay(
  events: DiaryTimelineEvent[],
  event: DiaryTimelineEvent,
  dayStart: Date,
  dayEnd: Date
): void {
  const timestampMs = event.timestamp.getTime();
  if (timestampMs >= dayStart.getTime() && timestampMs <= dayEnd.getTime()) {
    events.push(event);
  }
}

function mergeWorkIntervals(
  intervals: WorkInterval[],
  maxGapMs: number = 0
): WorkInterval[] {
  if (intervals.length === 0) return [];

  const sortedIntervals = [...intervals].sort(
    (firstInterval, secondInterval) => {
      const startDiff = firstInterval.startMs - secondInterval.startMs;
      if (startDiff !== 0) return startDiff;
      return firstInterval.endMs - secondInterval.endMs;
    }
  );

  const mergedIntervals: WorkInterval[] = [];
  let currentStartMs = sortedIntervals[0].startMs;
  let currentEndMs = sortedIntervals[0].endMs;

  for (const interval of sortedIntervals.slice(1)) {
    if (interval.startMs <= currentEndMs + maxGapMs) {
      currentEndMs = Math.max(currentEndMs, interval.endMs);
      continue;
    }

    mergedIntervals.push({ startMs: currentStartMs, endMs: currentEndMs });
    currentStartMs = interval.startMs;
    currentEndMs = interval.endMs;
  }

  mergedIntervals.push({ startMs: currentStartMs, endMs: currentEndMs });
  return mergedIntervals;
}

function calculateDedupedWorkMs(intervals: WorkInterval[]): number {
  return mergeWorkIntervals(intervals).reduce(
    (totalMs, interval) => totalMs + interval.endMs - interval.startMs,
    0
  );
}

function getEventTimeMs(event: SessionEvent, now: Date): number | null {
  const parsed = parseApiDate(event.createdAt);
  if (!parsed) return null;
  return Math.min(parsed.getTime(), now.getTime());
}

function getCommitTime(commit: GitCommitInfo): Date | null {
  return parseApiDate(commit.committer?.date || commit.author?.date);
}

export function buildDiaryCommitMarkers(
  commits: GitCommitInfo[],
  dayStart: Date,
  dayEnd: Date,
  tasks: KanbanTask[] = []
): DiaryCommitMarker[] {
  const sortedTasks = [...tasks].sort((firstTask, secondTask) => {
    const firstTime = parseApiDate(firstTask.created_at)?.getTime() ?? 0;
    const secondTime = parseApiDate(secondTask.created_at)?.getTime() ?? 0;
    return firstTime - secondTime;
  });

  const markers = commits
    .map((commit): DiaryCommitMarker | null => {
      const timestamp = getCommitTime(commit);
      if (!timestamp) return null;
      const timestampMs = timestamp.getTime();
      if (timestampMs < dayStart.getTime() || timestampMs > dayEnd.getTime()) {
        return null;
      }

      const task = findNearestTaskForCommit(timestamp, sortedTasks);
      return {
        id: `commit:${commit.sha}`,
        commit,
        timestamp,
        task,
        sessionId: task?.session_id,
      } satisfies DiaryCommitMarker;
    })
    .filter((marker): marker is DiaryCommitMarker => marker !== null);

  markers.sort((firstMarker, secondMarker) => {
    const diff =
      firstMarker.timestamp.getTime() - secondMarker.timestamp.getTime();
    if (diff !== 0) return diff;
    return firstMarker.commit.sha.localeCompare(secondMarker.commit.sha);
  });

  return markers;
}

function findNearestTaskForCommit(
  timestamp: Date,
  sortedTasks: KanbanTask[]
): KanbanTask | undefined {
  const timestampMs = timestamp.getTime();
  let bestTask: KanbanTask | undefined;
  let bestDistanceMs = Number.POSITIVE_INFINITY;

  for (const task of sortedTasks) {
    const start = parseApiDate(task.created_at);
    if (!start) continue;
    const completed = parseApiDate(task.completed_at ?? task.updated_at);
    const end = completed ?? start;
    const startMs = start.getTime();
    const endMs = Math.max(end.getTime(), startMs);

    const distanceMs =
      timestampMs < startMs
        ? startMs - timestampMs
        : timestampMs > endMs
          ? timestampMs - endMs
          : 0;

    if (distanceMs < bestDistanceMs) {
      bestDistanceMs = distanceMs;
      bestTask = task;
    }
  }

  return bestTask;
}

function buildRoundWorkIntervals(
  task: KanbanTask,
  events: SessionEvent[] | undefined,
  now: Date
): WorkInterval[] {
  if (!events || events.length === 0) return [];

  const sortedEventTimes = events
    .map((event) => getEventTimeMs(event, now))
    .filter((timeMs): timeMs is number => timeMs !== null)
    .sort((firstTimeMs, secondTimeMs) => firstTimeMs - secondTimeMs);

  if (sortedEventTimes.length === 0) return [];

  const intervals: WorkInterval[] = [];
  let currentStartMs = sortedEventTimes[0];
  let currentEndMs = sortedEventTimes[0];

  for (const eventTimeMs of sortedEventTimes.slice(1)) {
    if (eventTimeMs <= currentEndMs + ROUND_INTERVAL_MERGE_GAP_MS) {
      currentEndMs = Math.max(currentEndMs, eventTimeMs);
      continue;
    }

    if (currentEndMs > currentStartMs) {
      intervals.push({ startMs: currentStartMs, endMs: currentEndMs });
    }
    currentStartMs = eventTimeMs;
    currentEndMs = eventTimeMs;
  }

  const terminalEnd = isTerminalTask(task)
    ? parseApiDate(task.completed_at ?? task.updated_at ?? task.created_at)
    : null;
  if (terminalEnd) {
    const terminalEndMs = Math.min(terminalEnd.getTime(), now.getTime());
    if (terminalEndMs <= currentEndMs + ROUND_INTERVAL_MERGE_GAP_MS) {
      currentEndMs = Math.max(currentEndMs, terminalEndMs);
    }
  }

  if (currentEndMs > currentStartMs) {
    intervals.push({ startMs: currentStartMs, endMs: currentEndMs });
  }

  return mergeWorkIntervals(intervals, ROUND_INTERVAL_MERGE_GAP_MS);
}

export function buildDiaryDaySummary(
  tasks: KanbanTask[],
  date: Date,
  now: Date = new Date(),
  eventsBySessionId: ReadonlyMap<string, SessionEvent[]> = new Map(),
  commits: GitCommitInfo[] = []
): DiaryDaySummary {
  const dayStart = getStartOfLocalDay(date);
  const dayEnd = getEndOfLocalDay(date);
  const uniqueActiveSessionIds = new Set<string>();
  const uniqueCompletedSessionIds = new Set<string>();
  const workIntervals: WorkInterval[] = [];
  const diaryWorkIntervals: DiaryWorkInterval[] = [];
  const events: DiaryTimelineEvent[] = [];
  let engineeringMs = 0;

  for (const task of tasks) {
    if (!task.created_at) continue;
    const parsedStart = parseApiDate(task.created_at);
    if (!parsedStart) continue;
    const start = parsedStart.getTime() > now.getTime() ? now : parsedStart;
    const end = getTaskEnd(task, start, now);

    if (!overlapsDay(start, end, dayStart, dayEnd)) continue;

    const roundIntervals = buildRoundWorkIntervals(
      task,
      task.session_id ? eventsBySessionId.get(task.session_id) : undefined,
      now
    );
    const sourceIntervals =
      roundIntervals.length > 0
        ? roundIntervals
        : [{ startMs: start.getTime(), endMs: end.getTime() }];

    for (const sourceInterval of sourceIntervals) {
      if (
        sourceInterval.startMs > dayEnd.getTime() ||
        sourceInterval.endMs < dayStart.getTime()
      ) {
        continue;
      }

      const clippedStartMs = Math.max(
        sourceInterval.startMs,
        dayStart.getTime()
      );
      const clippedEndMs = Math.min(sourceInterval.endMs, dayEnd.getTime());
      const durationMs = Math.max(0, clippedEndMs - clippedStartMs);
      engineeringMs += durationMs;
      if (durationMs > 0) {
        workIntervals.push({ startMs: clippedStartMs, endMs: clippedEndMs });
        diaryWorkIntervals.push({
          id: `${task.id}:work:${clippedStartMs}:${clippedEndMs}`,
          task,
          start: new Date(clippedStartMs),
          end: new Date(clippedEndMs),
          startsBeforeDay: sourceInterval.startMs < dayStart.getTime(),
          endsAfterDay: sourceInterval.endMs > dayEnd.getTime(),
        });
      }
    }
    uniqueActiveSessionIds.add(task.id);

    pushEventIfInDay(
      events,
      {
        id: `${task.id}:started`,
        kind: DIARY_EVENT_KIND.Started,
        timestamp: start,
        task,
      },
      dayStart,
      dayEnd
    );

    if (isTerminalTask(task)) {
      const completedInDay =
        end.getTime() >= dayStart.getTime() &&
        end.getTime() <= dayEnd.getTime();
      if (completedInDay) uniqueCompletedSessionIds.add(task.id);
      pushEventIfInDay(
        events,
        {
          id: `${task.id}:completed`,
          kind: DIARY_EVENT_KIND.Completed,
          timestamp: end,
          task,
        },
        dayStart,
        dayEnd
      );
    } else if (dayEnd.getTime() <= now.getTime()) {
      pushEventIfInDay(
        events,
        {
          id: `${task.id}:still-working:${dayEnd.getTime()}`,
          kind: DIARY_EVENT_KIND.StillWorking,
          timestamp: dayEnd,
          task,
        },
        dayStart,
        dayEnd
      );
    }
  }

  events.sort((firstEvent, secondEvent) => {
    const diff =
      firstEvent.timestamp.getTime() - secondEvent.timestamp.getTime();
    if (diff !== 0) return diff;
    return firstEvent.id.localeCompare(secondEvent.id);
  });

  return {
    dayStart,
    engineeringMinutes: Math.round(engineeringMs / 60_000),
    onlineMinutes: Math.round(calculateDedupedWorkMs(workIntervals) / 60_000),
    activeSessions: uniqueActiveSessionIds.size,
    completedSessions: uniqueCompletedSessionIds.size,
    events,
    workIntervals: diaryWorkIntervals,
    commits: buildDiaryCommitMarkers(commits, dayStart, dayEnd, tasks),
  };
}

export function formatDiaryDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
