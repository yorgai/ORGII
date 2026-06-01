/**
 * useSubagentSessions — detect subagent child sessions via DB query.
 *
 * Instead of scanning parent events for stamped `subagentSessionId` args,
 * queries the `agent_sessions` table directly via `es_get_child_sessions`.
 * Each child row carries its own `session_id`, `status`, `created_at`, and
 * `updated_at` — no dependency on Rust-side event stamping.
 *
 * ## Video-editor clip model
 *
 * Each subagent is a "clip" on the parent timeline:
 *   - `startedAtMs` = child session's `created_at`
 *   - `endedAtMs` = child session's `updated_at` when completed/failed,
 *     or `null` when still running (clip stays open).
 *
 * `useActiveSubagentsAtCursor` filters the full list to clips whose window
 * covers the current replay cursor timestamp.
 */
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

export interface SubagentSession {
  /** Stable React key — equals the child session id. */
  key: string;
  /** Concrete child session id (always non-null from DB). */
  sessionId: string;
  /** Agent name for UI — derived from DB `name` with `AgentName (task)` → agent only. */
  name: string;
  /** Task title for UI — derived from DB `name` with `AgentName (task)` → task only. */
  description: string;
  /** DB `agent_sessions.session_type` (Rust unified session record). */
  sessionType: string;
  status: "pending" | "running" | "completed" | "failed";
  /** Whether the subagent was spawned in background mode. */
  isBackground: boolean;
  /** Epoch ms when the subagent was spawned. */
  startedAtMs: number;
  /** Epoch ms when the subagent finished, or `null` if still running. */
  endedAtMs: number | null;
}

interface ChildSessionRecord {
  sessionId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  sessionType: string;
  parentSessionId: string | null;
  parentEventId: string | null;
}

function mapStatus(raw: string): SubagentSession["status"] {
  if (raw === "completed") return "completed";
  if (raw === "failed" || raw === "error") return "failed";
  if (raw === "running" || raw === "streaming") return "running";
  return "pending";
}

/**
 * Rust persists delegate child `name` as `AgentName (task text)` (see agent tool
 * `upsert_session`). For grid titles we show only the task portion, not
 * `Explore (…)`.
 */
export function extractSubagentSessionTaskTitle(rawName: string): string {
  const marker = " (";
  const idx = rawName.indexOf(marker);
  if (idx === -1) return rawName;
  const afterOpen = rawName.slice(idx + marker.length);
  const lastClose = afterOpen.lastIndexOf(")");
  if (lastClose < 0) return rawName;
  return afterOpen.slice(0, lastClose).trim();
}

/**
 * A subagent row is considered "assigned a task" iff the parsed task
 * portion of its name is non-empty. Rust persists delegate child
 * sessions as `AgentName (task text)` via `upsert_session`, so a child
 * with no task either:
 *
 *   - was created without a delegated payload (e.g. parent stamped the
 *     child id before the delegate tool actually filled out the task), or
 *   - is a placeholder row from a failed/canceled spawn.
 *
 * In both cases, opening a ChatHistory panel for that subagent shows a
 * "failed to load" placeholder because there is nothing to render — so
 * we drop the row at the data source instead of papering over it in
 * each consumer (grid cell, PIP card, multi-event subscription).
 */
function isSubagentTaskAssigned(rawName: string): boolean {
  return extractSubagentSessionTaskTitle(rawName).trim().length > 0;
}

/**
 * Strip a leading `{agentName}` prefix (optionally followed by `:`, `-`,
 * or `·`) from the task title so a row labelled `Planner` doesn't render
 * as `Planner · Planner: Breaks down …`. Rust populates the parenthetical
 * with `<AgentName>: <description>` for some delegate variants, which is
 * useful when the title stands alone but redundant in our two-line
 * (name · description) cell header.
 */
export function stripAgentNamePrefix(
  taskTitle: string,
  agentName: string
): string {
  const trimmedTitle = taskTitle.trim();
  const trimmedName = agentName.trim();
  if (!trimmedName) return trimmedTitle;
  if (!trimmedTitle.toLowerCase().startsWith(trimmedName.toLowerCase())) {
    return trimmedTitle;
  }
  const rest = trimmedTitle.slice(trimmedName.length).trimStart();
  // Strip a single separator if it's the first character after the name.
  const stripped = rest.replace(/^[:\-·•—]\s*/u, "");
  return stripped.length > 0 ? stripped : trimmedTitle;
}

export function extractSubagentSessionAgentName(rawName: string): string {
  const parenIndex = rawName.indexOf(" (");
  const dotIndex = rawName.indexOf(" · ");
  const bulletIndex = rawName.indexOf(" • ");
  const splitIndex = [parenIndex, dotIndex, bulletIndex]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  if (splitIndex === undefined) return rawName.trim();
  return rawName.slice(0, splitIndex).trim();
}

/**
 * Check whether a subagent's time window covers a given cursor timestamp.
 */
export function isActiveAtTimestamp(
  sub: SubagentSession,
  cursorMs: number
): boolean {
  if (cursorMs < sub.startedAtMs) return false;
  if (sub.endedAtMs === null) return true;
  return cursorMs <= sub.endedAtMs;
}

/**
 * Query child sessions from the DB for a given parent session.
 *
 * The `eventCount` parameter is used as a re-fetch trigger: whenever the
 * parent event list grows (live streaming), we re-query the DB to pick up
 * newly spawned child sessions.
 */
export function useSubagentSessions(
  parentSessionId: string | null,
  eventCount: number
): SubagentSession[] {
  const [rawSessions, setRawSessions] = useState<{
    parentId: string | null;
    list: SubagentSession[];
  }>({ parentId: parentSessionId, list: [] });
  const lastQueryRef = useRef<string | null>(null);

  // Discard stale sessions from a previous parent without an extra render.
  const sessions =
    rawSessions.parentId === parentSessionId ? rawSessions.list : [];

  const setSessions = useCallback(
    (list: SubagentSession[]) =>
      setRawSessions({ parentId: parentSessionId, list }),
    [parentSessionId]
  );

  const loadChildSessions = useCallback(
    async (parentId: string): Promise<SubagentSession[]> => {
      const records = await invoke<ChildSessionRecord[]>(
        "es_get_child_sessions",
        { parentSessionId: parentId }
      );

      const mapped = records
        .filter((record) => {
          // Skip subagents that haven't been assigned a task yet. Loading
          // a ChatHistory for them would render a "failed to load"
          // placeholder because the EventStore for the child session has
          // nothing useful in it. See `isSubagentTaskAssigned` above.
          const rawName = record.name || record.sessionId;
          return isSubagentTaskAssigned(rawName);
        })
        .map((record) => {
          const status = mapStatus(record.status);
          const startedAtMs = new Date(record.createdAt).getTime();
          const isTerminal = status === "completed" || status === "failed";
          const endedAtMs = isTerminal
            ? new Date(record.updatedAt).getTime()
            : null;

          const rawName = record.name || record.sessionId;
          const agentName = extractSubagentSessionAgentName(rawName);
          const taskTitle = extractSubagentSessionTaskTitle(rawName);

          return {
            key: record.sessionId,
            sessionId: record.sessionId,
            name: agentName,
            description: stripAgentNamePrefix(taskTitle, agentName),
            sessionType: record.sessionType,
            status,
            isBackground: true,
            startedAtMs,
            endedAtMs,
          };
        });

      // Stable sort: subagents that have actually started (any non-pending
      // status) come first so the bottom strip / grid always shows
      // populated cells before empty / not-yet-started ones. Within each
      // group, preserve insertion order so cells don't reshuffle as the
      // backend updates a single status field.
      const indexById = new Map(
        mapped.map((session, index) => [session.sessionId, index])
      );
      const isReady = (status: SubagentSession["status"]): boolean =>
        status !== "pending";
      mapped.sort((left, right) => {
        const leftReady = isReady(left.status);
        const rightReady = isReady(right.status);
        if (leftReady === rightReady) {
          return (
            (indexById.get(left.sessionId) ?? 0) -
            (indexById.get(right.sessionId) ?? 0)
          );
        }
        return leftReady ? -1 : 1;
      });
      return mapped;
    },
    []
  );

  useEffect(() => {
    if (!parentSessionId) {
      lastQueryRef.current = null;
      queueMicrotask(() => setSessions([]));
      return;
    }

    const queryKey = `${parentSessionId}:${eventCount}`;
    if (queryKey === lastQueryRef.current) return;
    lastQueryRef.current = queryKey;

    let cancelled = false;
    loadChildSessions(parentSessionId)
      .then((mapped) => {
        if (cancelled) return;
        queueMicrotask(() => setSessions(mapped));
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[useSubagentSessions] fetch failed", err);
      });

    return () => {
      cancelled = true;
    };
  }, [parentSessionId, eventCount, loadChildSessions, setSessions]);

  return sessions;
}

/**
 * From the full list of subagent sessions, return only those whose time
 * window covers the current replay cursor event.
 */
export function useActiveSubagentsAtCursor(
  allSubagents: SubagentSession[],
  cursorEvent: SessionEvent | null
): SubagentSession[] {
  return useMemo(() => {
    if (!cursorEvent || allSubagents.length === 0) {
      return [];
    }
    const cursorMs = new Date(cursorEvent.createdAt).getTime();
    return allSubagents.filter((sub) => isActiveAtTimestamp(sub, cursorMs));
  }, [allSubagents, cursorEvent]);
}
