/**
 * Turn-page formatting helpers.
 *
 * Used by the turn pagination controls to produce preview text for the
 * round label and a HH:MM start/end clock range.
 * Ranges shorter than one minute render as a single HH:MM timestamp.
 */
import type { CursorIdeTurnSummary } from "@src/api/tauri/cursorIde";

import type { ChatGroupMeta } from "../hooks/useChatGroups";

const ROUND_PREVIEW_MAX_LENGTH = 96;
const MIN_TIME_RANGE_MS = 60_000;

export function getRoundPreviewText(displayText: string | undefined): string {
  const normalizedText = (displayText ?? "").replace(/\s+/g, " ").trim();
  if (normalizedText.length <= ROUND_PREVIEW_MAX_LENGTH) return normalizedText;
  return `${normalizedText.slice(0, ROUND_PREVIEW_MAX_LENGTH - 1)}…`;
}

export function formatCursorIdeTurnPageTimeLabel(
  summary: CursorIdeTurnSummary
): string {
  const startMs = Date.parse(summary.startedAt);
  const endMs = summary.endedAt ? Date.parse(summary.endedAt) : startMs;

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "";
  return formatClockRange(startMs, endMs);
}

export function formatTurnPageTimeLabel(metas: ChatGroupMeta[]): string {
  let startMs: number | null = null;
  let endMs: number | null = null;

  for (const meta of metas) {
    if (meta.startMs !== null && (startMs === null || meta.startMs < startMs)) {
      startMs = meta.startMs;
    }
    if (meta.endMs !== null && (endMs === null || meta.endMs > endMs)) {
      endMs = meta.endMs;
    }
  }

  if (startMs === null || endMs === null) return "";

  return formatClockRange(startMs, endMs);
}

function formatClockRange(startMs: number, endMs: number): string {
  const startClock = formatClockTime(startMs);
  if (!startClock) return "";
  if (endMs - startMs < MIN_TIME_RANGE_MS) return startClock;

  const endClock = formatClockTime(endMs);
  if (!endClock) return "";

  return `${startClock} ~ ${endClock}`;
}

function formatClockTime(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  try {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}
