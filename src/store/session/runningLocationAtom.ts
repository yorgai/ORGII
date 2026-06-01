/**
 * Running location atom
 *
 * Persists the session's running location to localStorage.
 * Used by the session creator to track whether the session runs
 * locally or in a git worktree.
 */
import { atomWithStorage } from "jotai/utils";

import type { RunningLocation } from "@src/features/SessionCreator/config";

const STORAGE_KEY = "orgii:runningLocation";

export const runningLocationAtom = atomWithStorage<RunningLocation>(
  STORAGE_KEY,
  "local"
);
