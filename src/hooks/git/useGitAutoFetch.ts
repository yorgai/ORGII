/**
 * useGitAutoFetch Hook
 *
 * Background worker that periodically runs `git fetch` to keep remote
 * tracking refs up-to-date. This ensures the ahead/behind counts shown
 * in the status bar reflect the real remote state.
 *
 * Reads the user's settings via `gitAutoFetchAtom` and
 * `gitAutoFetchIntervalAtom`. When auto-fetch is disabled the hook is
 * a no-op.
 */
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import { useGitStatus } from "@src/contexts/git";
import { GitOperationsService } from "@src/services/git/GitOperationsService";
import {
  gitAutoFetchAtom,
  gitAutoFetchIntervalAtom,
} from "@src/store/ui/editorSettingsAtom";

const MIN_INTERVAL_MS = 30_000;

export function useGitAutoFetch(): void {
  const autoFetch = useAtomValue(gitAutoFetchAtom);
  const intervalSeconds = useAtomValue(gitAutoFetchIntervalAtom);
  const { hasActiveRepo } = useGitStatus();

  const fetchInProgressRef = useRef(false);

  useEffect(() => {
    if (!autoFetch || !hasActiveRepo) return;

    const intervalMs = Math.max(intervalSeconds * 1000, MIN_INTERVAL_MS);

    const tick = async () => {
      if (fetchInProgressRef.current) return;
      fetchInProgressRef.current = true;
      try {
        await GitOperationsService.fetch();
      } catch {
        // Background fetch failures are non-critical — silently ignored.
      } finally {
        fetchInProgressRef.current = false;
      }
    };

    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [autoFetch, intervalSeconds, hasActiveRepo]);
}
