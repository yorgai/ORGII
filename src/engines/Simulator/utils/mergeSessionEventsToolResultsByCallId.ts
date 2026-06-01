/**
 * Merges `result` (and richest `extracted` for file tools) for all SessionEvents
 * that share the same tool call id.
 *
 * Subagent grid cells pass the raw event list from EventStore. The store often
 * keeps **tool_call** and **tool_result** as separate rows. `deriveIDEState` /
 * `convertToFileOperation` run per row; the **call** row may have no file body
 * while the **result** row does. The main simulator timeline sometimes merges
 * these server-side; for child sessions we merge here so any index shows full
 * payloads.
 */
import type { SessionEvent } from "@src/engines/SessionCore";
import type { ExtractedData } from "@src/engines/SessionCore/core/types";

export function extractCallIdFromSessionEvent(
  event: SessionEvent
): string | undefined {
  if (typeof event.callId === "string" && event.callId.length > 0) {
    return event.callId;
  }
  const args = event.args as Record<string, unknown> | undefined;
  if (args && typeof args.call_id === "string") {
    return args.call_id;
  }
  const result = event.result as Record<string, unknown> | undefined;
  if (result && typeof result.call_id === "string") {
    return result.call_id;
  }
  return undefined;
}

function deepMergeResultObjects(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const ov = override[key];
    const bv = base[key];
    if (
      ov !== null &&
      typeof ov === "object" &&
      !Array.isArray(ov) &&
      bv !== null &&
      typeof bv === "object" &&
      !Array.isArray(bv)
    ) {
      out[key] = deepMergeResultObjects(
        bv as Record<string, unknown>,
        ov as Record<string, unknown>
      );
    } else {
      out[key] = ov;
    }
  }
  return out;
}

/** Coerce wire `result` to an object so string bodies (DB / legacy) merge. */
function resultToObject(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  if (typeof result === "string" && result.length > 0) {
    return {
      content: result,
      observation: result,
    };
  }
  return {};
}

function mergeGroupResults(
  sortedOldestFirst: SessionEvent[]
): Record<string, unknown> {
  let merged: Record<string, unknown> = {};
  for (const ev of sortedOldestFirst) {
    const chunk = resultToObject(ev.result);
    merged = deepMergeResultObjects(merged, chunk);
  }
  return merged;
}

function pickRichestFileExtracted(
  sortedOldestFirst: SessionEvent[]
): ExtractedData | undefined {
  let best: ExtractedData | undefined;
  for (const ev of sortedOldestFirst) {
    const ex = ev.extracted;
    if (
      ex &&
      ex.kind === "file" &&
      typeof ex.content === "string" &&
      ex.content.length > 0
    ) {
      best = ex;
    }
  }
  return best;
}

/**
 * Returns a new event array (same order) where every event with a call id
 * receives the merged `result` for its group and, when available, the richest
 * `extracted` file payload from that group.
 */
export function mergeSessionEventsToolResultsByCallId(
  events: SessionEvent[]
): SessionEvent[] {
  if (events.length === 0) return events;

  const byCallId = new Map<string, SessionEvent[]>();
  for (const event of events) {
    const cid = extractCallIdFromSessionEvent(event);
    if (!cid) continue;
    const list = byCallId.get(cid) ?? [];
    list.push(event);
    byCallId.set(cid, list);
  }

  const mergedResultByCallId = new Map<string, Record<string, unknown>>();
  const bestExtractedByCallId = new Map<string, ExtractedData | undefined>();

  for (const [cid, group] of byCallId) {
    const sorted = [...group].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    mergedResultByCallId.set(cid, mergeGroupResults(sorted));
    const bestEx = pickRichestFileExtracted(sorted);
    if (bestEx) {
      bestExtractedByCallId.set(cid, bestEx);
    }
  }

  return events.map((event) => {
    const cid = extractCallIdFromSessionEvent(event);
    if (!cid) return event;

    const mergedResult = mergedResultByCallId.get(cid);
    const bestEx = bestExtractedByCallId.get(cid);

    const next: SessionEvent = { ...event };
    if (mergedResult) {
      next.result = mergedResult;
    }
    if (bestEx) {
      next.extracted = bestEx;
    }
    return next;
  });
}
