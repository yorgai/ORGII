/**
 * Selected worktree path atom
 *
 * Stores the absolute path of an existing git worktree the user
 * picked from the running-location dropdown. When set, the session
 * launch uses this path directly instead of creating a new worktree.
 *
 * Cleared whenever the user switches the running location back to
 * "local" or chooses "New Worktree".
 */
import { atom } from "jotai";

export const selectedWorktreePathAtom = atom<string | null>(null);
