/**
 * useSessionOutcomeStatsFlush
 *
 * One-shot writeback of file-change outcome statistics to the session DB.
 *
 * Git stats (commit count, PR count, first PR URL) are backfilled on the Rust
 * side in `es_load_from_cache` for CLI sessions and Cursor IDE imports.  This
 * hook only persists the file-diff counters that come from the frontend diff
 * pipeline (files_changed, lines_added, lines_removed).
 *
 * Trigger: whenever `fileChangeStats` settles to a non-zero value for the
 * session.  A 1.5 s debounce absorbs rapid re-renders while diffs are
 * streaming in.  We skip the write when the session DB row already has non-zero
 * file-change stats (i.e. a previous run already persisted them).
 */
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import { rpc } from "@src/api/tauri/rpc";
import type { SessionPatchPayload } from "@src/api/tauri/rpc/schemas/sessionAggregate";
import { DISPATCH_CATEGORY } from "@src/api/tauri/session/dispatchTypes";
import { createLogger } from "@src/hooks/logger";
import { sessionByIdAtom } from "@src/store/session/sessionAtom/atoms";
import { upsertSession } from "@src/store/session/sessionAtom/mutations";
import { getDispatchCategory } from "@src/util/session/sessionDispatch";

import type { FileChangeStats } from "../InputArea/hooks/useComposerSections";

const logger = createLogger("SessionOutcomeStatsFlush");

const DEBOUNCE_MS = 1_500;

// Process-lifetime set of session IDs we have already written file-change stats
// for.  Prevents duplicate writes if the component remounts.
const flushedSessions = new Set<string>();

export interface UseSessionOutcomeStatsFlushOptions {
  sessionId: string;
  fileChangeStats: FileChangeStats;
}

export function useSessionOutcomeStatsFlush({
  sessionId,
  fileChangeStats,
}: UseSessionOutcomeStatsFlushOptions): void {
  const category = getDispatchCategory(sessionId);

  // Rust agent sessions handle their own stats in the post-turn pipeline.
  const shouldFlush = category !== DISPATCH_CATEGORY.RUST_AGENT;

  const session = useAtomValue(sessionByIdAtom(sessionId));
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!shouldFlush) return;
    if (flushedSessions.has(sessionId)) return;

    // Skip if the session DB row already has file-change stats persisted from a
    // prior visit.
    const alreadyPopulated = (session?.filesChanged ?? 0) > 0;
    if (alreadyPopulated) {
      flushedSessions.add(sessionId);
      return;
    }

    const filesChanged = fileChangeStats.count;
    const linesAdded = fileChangeStats.additions;
    const linesRemoved = fileChangeStats.deletions;

    // Nothing to write yet — wait for diff stats to arrive.
    if (filesChanged === 0) return;

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;

      if (flushedSessions.has(sessionId)) return;

      flushedSessions.add(sessionId);

      const patch: SessionPatchPayload["patch"] = {};
      if (filesChanged > 0) patch.filesChanged = filesChanged;
      if (linesAdded > 0) patch.linesAdded = linesAdded;
      if (linesRemoved > 0) patch.linesRemoved = linesRemoved;

      // Optimistic update — make hovercard / Kanban reflect new values
      // immediately without waiting for the next session list reload.
      const snap = sessionRef.current;
      if (snap) {
        upsertSession({ ...snap, filesChanged, linesAdded, linesRemoved });
      }

      rpc.sessionAggregate.patch({ sessionId, patch }).catch((err: unknown) => {
        logger.warn("file-change stats flush failed", err);
        flushedSessions.delete(sessionId);
      });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [
    sessionId,
    shouldFlush,
    session?.filesChanged,
    fileChangeStats.count,
    fileChangeStats.additions,
    fileChangeStats.deletions,
  ]);
}
