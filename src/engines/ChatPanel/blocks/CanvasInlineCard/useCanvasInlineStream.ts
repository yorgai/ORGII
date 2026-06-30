/**
 * useCanvasInlineStream — subscribe to canvas-inline-event window events.
 *
 * Fired by toolHandlers.dispatchCanvasInlineEvent() when the agent calls
 * `render_inline_canvas`. Returns the latest payload for the current session,
 * or null when no event has arrived.
 *
 * Design:
 * - The stored record carries the sessionId that produced it. On render, if
 *   the stored sessionId differs from the current prop we return null, giving
 *   callers a clean "no data yet" signal without any setState-in-effect.
 * - The event listener uses a ref that is kept synchronous with the prop via
 *   a dedicated useEffect. The single-frame stale window during which the ref
 *   may lag is benign: the event guard (`eventSessionId !== sessionIdRef.current`)
 *   will simply drop the event, and the next event push will carry the correct
 *   sessionId. No stale payload can appear for the new session.
 * - A2UI lines are accumulated across multiple pushes for the same session.
 */
import { useEffect, useRef, useState } from "react";

import type { CanvasInlineMode } from "./types";

export interface CanvasInlinePayload {
  mode: CanvasInlineMode;
  content?: string;
  url?: string;
  title?: string;
  streaming?: boolean;
  eventId?: string;
}

interface CanvasInlineEventDetail {
  sessionId: string;
  payload: CanvasInlinePayload;
}

interface PayloadRecord {
  sessionId: string | null | undefined;
  payload: CanvasInlinePayload;
}

/** Maximum number of characters retained in the merged A2UI buffer per session to prevent unbounded growth. */
const MAX_A2UI_CONTENT_CHARS = 200_000;

export function useCanvasInlineStream(
  sessionId: string | null | undefined
): CanvasInlinePayload | null {
  const [record, setRecord] = useState<PayloadRecord | null>(null);

  // sessionIdRef is kept synchronised via a dedicated effect so the event
  // listener (registered once) always reads the most recent session value.
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;

    function handleEvent(raw: Event) {
      if (cancelled) return;
      const event = raw as CustomEvent<CanvasInlineEventDetail>;
      const { sessionId: eventSessionId, payload: incoming } = event.detail;

      // Silently drop events that don't belong to the currently active session.
      // If the ref hasn't updated yet (one-frame lag), the event is dropped and
      // will be re-sent on the next push — no stale payload surfaces.
      if (eventSessionId !== sessionIdRef.current) return;

      setRecord((prev) => {
        // Session mismatch in stored record (or first event) — start fresh
        if (!prev || prev.sessionId !== eventSessionId) {
          return { sessionId: eventSessionId, payload: incoming };
        }

        // Accumulate A2UI content across multiple streaming pushes.
        // We concatenate raw strings with a "\n" boundary between pushes —
        // the actual JSONL splitting happens in CanvasInlineCard, which is
        // aware of multi-line element fields (e.g. code blocks). Splitting
        // and filtering here would corrupt elements whose content fields
        // contain newlines.
        // Cap the merged content length (not line count) to prevent
        // unbounded string growth — keep the tail when the limit is hit.
        if (incoming.mode === "a2ui" && prev.payload.mode === "a2ui") {
          const prevContent = prev.payload.content ?? "";
          const incomingContent = incoming.content ?? "";
          const joiner =
            prevContent.length === 0 || prevContent.endsWith("\n") ? "" : "\n";
          let merged = `${prevContent}${joiner}${incomingContent}`;
          if (merged.length > MAX_A2UI_CONTENT_CHARS) {
            merged = merged.slice(merged.length - MAX_A2UI_CONTENT_CHARS);
          }
          return {
            sessionId: prev.sessionId,
            payload: { ...incoming, content: merged },
          };
        }

        // html / url: latest push replaces previous
        return { sessionId: prev.sessionId, payload: incoming };
      });
    }

    window.addEventListener("canvas-inline-event", handleEvent);
    return () => {
      cancelled = true;
      window.removeEventListener("canvas-inline-event", handleEvent);
    };
  }, []);

  // If the stored record belongs to a different session (session was switched
  // before any new event arrived), hide the stale payload without a setState.
  if (!record || record.sessionId !== sessionId) return null;
  return record.payload;
}
