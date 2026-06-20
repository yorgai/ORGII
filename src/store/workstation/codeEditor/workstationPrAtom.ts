import { atom } from "jotai";

import type { OpenPRItem } from "@src/api/tauri/github";

/**
 * Shared PR state for the active workstation repo.
 * Written by `useWorkstationPr` when eligibility or PR URL changes.
 * Read by Source Control surfaces and context collection.
 *
 * TODO(multi-panel): This is a single global atom. When multiple workstation
 * panels are open simultaneously they will share state incorrectly. Fix by
 * migrating to `atomFamily` keyed by `repoId` (from `jotai-family`), matching
 * the pattern used in `cursorModeOverrideAtom.ts`. Callers to update:
 *   - `useWorkstationPr` (useSetAtom → useAtom(workstationPrAtomFamily(repoId)))
 *   - `workstationPrCallbackAtom` consumers
 *   - Any other direct reader of `workstationPrAtom`
 */
export interface WorkstationPrSnapshot {
  /** The branch is eligible for PR creation (not default, pushed, clean) */
  readyToCreate: boolean;
  /** Existing PR URL if one has already been created/found */
  prUrl?: string;
  /** PR is currently being created */
  isCreating: boolean;
  /** Current branch has an upstream set on origin */
  hasUpstream: boolean;
  /** Number of uncommitted changes in the working tree */
  uncommittedCount: number;
  /** Current branch equals the repo default branch */
  isDefaultBranch: boolean;
}

export const workstationPrAtom = atom<WorkstationPrSnapshot>({
  readyToCreate: false,
  prUrl: undefined,
  isCreating: false,
  hasUpstream: false,
  uncommittedCount: 0,
  isDefaultBranch: false,
});

/**
 * Latest Source Control commit message for the active workstation repo.
 *
 * `useWorkstationPr` is mounted once at the editor level (see
 * `useSourceControlSetup`) where the commit form — and therefore the commit
 * message — is not in scope. The Source Control panel publishes its commit
 * summary here so the single PR mount can derive a meaningful PR title from
 * it. Empty when no Source Control panel is mounted, in which case the PR
 * title falls back to the branch name.
 */
export const workstationPrCommitMessageAtom = atom<string>("");

/**
 * All open pull requests for the active workstation repo.
 * Written by `useWorkstationPr` on mount and when the repo changes.
 * Read by `PullRequestContent` to render the full PR list.
 */
export const workstationAllOpenPrsAtom = atom<OpenPRItem[]>([]);

/**
 * Load lifecycle for `workstationAllOpenPrsAtom`. Lets the PR sidebar
 * distinguish "still fetching" from "truly empty" / "failed to fetch".
 *   - "idle"    : not yet attempted (no repo selected)
 *   - "loading" : in-flight request OR seeded from stale cache while refreshing
 *   - "ready"   : last fetch succeeded (list may be empty)
 *   - "error"   : last fetch threw (error message in `workstationOpenPrsErrorAtom`)
 */
export type WorkstationOpenPrsLoadState =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export const workstationOpenPrsLoadStateAtom =
  atom<WorkstationOpenPrsLoadState>("idle");

export const workstationOpenPrsErrorAtom = atom<string | null>(null);

/**
 * Stable ref-backed callback for triggering PR creation from Source Control UI.
 * Stored as a ref container to avoid stale closure issues with atom-stored functions.
 */
export const workstationPrCallbackAtom = atom<{
  createPr: (() => Promise<{ url?: string; error?: string }>) | null;
}>({ createPr: null });
