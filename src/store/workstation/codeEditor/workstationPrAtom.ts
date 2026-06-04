import { atom } from "jotai";

/**
 * Shared PR state for the active workstation repo.
 * Written by `useWorkstationPr` when eligibility or PR URL changes.
 * Read by `PinnedActionsBar` to show the "Open PR" quick-action pill.
 */
export interface WorkstationPrSnapshot {
  /** The branch is eligible for PR creation (not default, pushed, clean) */
  readyToCreate: boolean;
  /** Existing PR URL if one has already been created/found */
  prUrl?: string;
  /** PR is currently being created */
  isCreating: boolean;
  /** Trigger PR creation — injected by the hook */
  onCreatePr: (() => void) | null;
}

export const workstationPrAtom = atom<WorkstationPrSnapshot>({
  readyToCreate: false,
  prUrl: undefined,
  isCreating: false,
  onCreatePr: null,
});
