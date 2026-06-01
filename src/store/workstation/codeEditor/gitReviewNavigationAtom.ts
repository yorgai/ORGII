import { atom } from "jotai";

/**
 * Working-tree change list position for the git diff review floating bar (x/y).
 * Updated from source control when the selected file changes.
 */
export interface GitReviewNavigationSnapshot {
  /** 1-based index of the selected file in the change list, or 0 if not in the list */
  current: number;
  /** Total changed files in the list */
  total: number;
}

export const gitReviewNavigationAtom = atom<GitReviewNavigationSnapshot>({
  current: 0,
  total: 0,
});
