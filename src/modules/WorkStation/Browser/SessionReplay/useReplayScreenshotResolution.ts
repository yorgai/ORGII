import { useEffect, useRef } from "react";

import { invokeTauri } from "@src/util/platform/tauri/init";

import type { BrowserEntry } from "./types";
import { extractUnresolvedMarkerIds } from "./utils/browserEventUtils";

const SCREENSHOT_FETCH_FAILURE_TTL_MS = 60_000;
const MAX_CONCURRENT_SCREENSHOT_FETCHES = 4;

interface UseReplayScreenshotResolutionOptions {
  activeEntry: BrowserEntry | null | undefined;
  cache: Map<string, string>;
  insertCache: (entry: { id: string; base64: string }) => void;
  clearScreenshotCache: () => void;
  isBrowserReplayActive: boolean;
}

export function useReplayScreenshotResolution({
  activeEntry,
  cache,
  insertCache,
  clearScreenshotCache,
  isBrowserReplayActive,
}: UseReplayScreenshotResolutionOptions): void {
  const activeReplaySessionId = activeEntry?.event.sessionId ?? null;
  const inFlightScreenshotIdsRef = useRef<Set<string>>(new Set());
  const failedScreenshotFetchesRef = useRef<Map<string, number>>(new Map());
  const screenshotFetchGenerationRef = useRef(0);

  useEffect(() => {
    screenshotFetchGenerationRef.current += 1;
    inFlightScreenshotIdsRef.current.clear();
    failedScreenshotFetchesRef.current.clear();
    clearScreenshotCache();
  }, [activeReplaySessionId, clearScreenshotCache, isBrowserReplayActive]);

  useEffect(() => {
    if (!activeEntry) return;
    const unresolvedIds = Array.from(
      new Set(extractUnresolvedMarkerIds(activeEntry.event, cache))
    );
    if (unresolvedIds.length === 0) return;

    let cancelled = false;
    const generation = screenshotFetchGenerationRef.current;
    const inFlight = inFlightScreenshotIdsRef.current;
    const failedFetches = failedScreenshotFetchesRef.current;
    const now = Date.now();

    for (const [screenshotId, failedAt] of failedFetches) {
      if (now - failedAt > SCREENSHOT_FETCH_FAILURE_TTL_MS) {
        failedFetches.delete(screenshotId);
      }
    }

    for (const screenshotId of unresolvedIds) {
      if (inFlight.size >= MAX_CONCURRENT_SCREENSHOT_FETCHES) break;
      if (inFlight.has(screenshotId)) continue;
      const failedAt = failedFetches.get(screenshotId);
      if (failedAt && now - failedAt <= SCREENSHOT_FETCH_FAILURE_TTL_MS) {
        continue;
      }
      inFlight.add(screenshotId);

      invokeTauri<string | null>("browser_screenshot_get", { id: screenshotId })
        .then((base64) => {
          const isCurrentGeneration =
            generation === screenshotFetchGenerationRef.current;
          if (cancelled || !isCurrentGeneration) return;
          if (base64) {
            insertCache({ id: screenshotId, base64 });
            failedFetches.delete(screenshotId);
            return;
          }
          failedFetches.set(screenshotId, Date.now());
        })
        .catch(() => {
          if (generation === screenshotFetchGenerationRef.current) {
            failedFetches.set(screenshotId, Date.now());
          }
        })
        .finally(() => {
          inFlight.delete(screenshotId);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [activeEntry, cache, insertCache]);
}
