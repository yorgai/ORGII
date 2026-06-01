/**
 * CursorIdeFocusPoller
 *
 * Mounted by `ChatView` whenever the focused chat is a `cursoride-*`
 * session. Polls Cursor's `state.vscdb` for the focused composer's
 * `lastUpdatedAt` timestamp and force-reloads the EventStore when the
 * timestamp advances. No UI — purely a side-effect component so the
 * polling lifecycle is bound to the visible chat panel (one mount per
 * focused cursoride view) and dies the moment the user navigates away.
 *
 * Two-tier cadence: 1 s while we expect activity (right after a send,
 * or right after we observed a timestamp change), 4 s otherwise. Each
 * tick is one SQLite SELECT against `cursorDiskKV.composerData:<uuid>`;
 * the expensive `ensureCursorIdeEventsInStore` reload only fires when
 * the composer's `lastUpdatedAt` actually advanced, so the focused
 * chat picks up streamed bubbles within a second instead of waiting
 * for the user's next send to force a refresh.
 *
 * Paused while the document is hidden — no point polling a chat the
 * user isn't looking at.
 */
import { memo, useEffect, useRef } from "react";

import { cursorBridgeComposerLastUpdatedAt } from "@src/api/tauri/cursorBridge";
import { ensureCursorIdeEventsInStore } from "@src/engines/SessionCore/sync/adapters/cursorIdeAdapter";
import { composerIdFromSessionId } from "@src/util/session/sessionDispatch";

const POLL_INTERVAL_ACTIVE_MS = 1000;
const POLL_INTERVAL_IDLE_MS = 4000;
const ACTIVE_WINDOW_MS = 60_000;

interface CursorIdeFocusPollerProps {
  sessionId: string;
}

const CursorIdeFocusPoller = memo<CursorIdeFocusPollerProps>(
  ({ sessionId }) => {
    const composerId = composerIdFromSessionId(sessionId);

    // `lastSeenTimestampRef` holds the most recent `lastUpdatedAt`
    // we reloaded for. Same value next tick → skip the reload.
    // `activeUntilRef` is the wall-clock ms after which we drop back
    // to the idle cadence; bumped by every observed change.
    const lastSeenTimestampRef = useRef<number | null>(null);
    const activeUntilRef = useRef<number>(0);

    useEffect(() => {
      if (!composerId) return;

      let cancelled = false;
      let isRunning = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const tick = async () => {
        if (cancelled) return;
        // Guard against concurrent ticks (e.g. rapid visibilitychange
        // events firing before the previous CDP SELECT resolves).
        if (isRunning) return;
        isRunning = true;

        if (typeof document !== "undefined" && document.hidden) {
          isRunning = false;
          schedule(POLL_INTERVAL_IDLE_MS);
          return;
        }

        try {
          const ts = await cursorBridgeComposerLastUpdatedAt(composerId);
          if (cancelled) return;
          if (ts !== null && lastSeenTimestampRef.current === null) {
            lastSeenTimestampRef.current = ts;
          } else if (ts !== null && ts !== lastSeenTimestampRef.current) {
            lastSeenTimestampRef.current = ts;
            activeUntilRef.current = Date.now() + ACTIVE_WINDOW_MS;
            try {
              await ensureCursorIdeEventsInStore(sessionId, {
                forceReload: true,
              });
            } catch (err) {
              // Non-fatal: the next tick will retry. Don't surface
              // a toast — this runs every second and the user
              // already sees stale-but-readable state.
              // eslint-disable-next-line no-console
              console.warn(
                "[CursorIdeFocusPoller] reload failed",
                err instanceof Error ? err.message : String(err)
              );
            }
          }
        } catch (err) {
          // Probe SELECT can fail transiently (DB locked while
          // Cursor writes). Swallow and try again next tick.
          // eslint-disable-next-line no-console
          console.warn(
            "[CursorIdeFocusPoller] probe failed",
            err instanceof Error ? err.message : String(err)
          );
        }

        isRunning = false;
        if (cancelled) return;
        const interval =
          Date.now() < activeUntilRef.current
            ? POLL_INTERVAL_ACTIVE_MS
            : POLL_INTERVAL_IDLE_MS;
        schedule(interval);
      };

      function schedule(delayMs: number) {
        if (cancelled) return;
        timer = setTimeout(() => {
          void tick();
        }, delayMs);
      }

      // Start with the active cadence — the user just opened or
      // refocused this chat, so they're more likely to want fresh
      // state.
      activeUntilRef.current = Date.now() + ACTIVE_WINDOW_MS;
      schedule(POLL_INTERVAL_ACTIVE_MS);

      // Wake immediately on tab refocus instead of finishing the
      // current backoff. Otherwise the user could see stale state
      // for up to 4 s after switching back.
      const onVisibility = () => {
        if (typeof document === "undefined") return;
        if (!document.hidden && !cancelled) {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          activeUntilRef.current = Date.now() + ACTIVE_WINDOW_MS;
          // Only start a new tick if one isn't already in progress.
          if (!isRunning) {
            void tick();
          }
        }
      };
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisibility);
      }

      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        if (typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", onVisibility);
        }
      };
    }, [composerId, sessionId]);

    return null;
  }
);

CursorIdeFocusPoller.displayName = "CursorIdeFocusPoller";

export default CursorIdeFocusPoller;
