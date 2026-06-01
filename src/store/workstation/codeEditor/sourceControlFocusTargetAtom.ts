import { atom } from "jotai";

/**
 * Drives the inline scroll/highlight target for the All Changes view inside
 * the unified Source Control tab. When a sidebar file row is clicked while
 * the tab is in All Changes mode, this atom is bumped so the corresponding
 * file section expands and scrolls into view.
 */
export interface SourceControlFocusTarget {
  path: string;
  nonce: number;
}

export const sourceControlFocusTargetAtom =
  atom<SourceControlFocusTarget | null>(null);
sourceControlFocusTargetAtom.debugLabel = "sourceControlFocusTargetAtom";
