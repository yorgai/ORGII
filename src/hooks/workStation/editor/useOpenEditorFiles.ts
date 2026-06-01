/**
 * useOpenEditorFiles Hook
 *
 * Returns a list of currently open file paths from all editor panes.
 * Used by search panel for "Only search in open files" feature.
 *
 * PERFORMANCE (Jan 2026):
 * Uses useMemo for memoization - array reference stays stable when
 * tab dependencies don't change.
 *
 * MIGRATION (Jan 2026):
 * Updated to use workstationLayoutAtom directly - supports multi-split layouts.
 */
import { useAtomValue } from "jotai";
import { useMemo } from "react";

import { workstationLayoutAtom } from "@src/store/workstation/tabs";

export interface UseOpenEditorFilesResult {
  /** Array of absolute file paths currently open in the editor */
  openFiles: string[];
}

/**
 * Get list of currently open file paths from all editor panes
 */
export function useOpenEditorFiles(): UseOpenEditorFilesResult {
  const layout = useAtomValue(workstationLayoutAtom);

  const openFiles = useMemo(() => {
    const filePaths = new Set<string>();
    const tabs = layout?.mainPane?.tabs ?? [];
    for (const tab of tabs) {
      if (tab.type === "file" || tab.type === "git-diff") {
        const filePath = tab.data.filePath as string | undefined;
        if (filePath) filePaths.add(filePath);
      }
    }
    return Array.from(filePaths).sort();
  }, [layout]);

  return { openFiles };
}
