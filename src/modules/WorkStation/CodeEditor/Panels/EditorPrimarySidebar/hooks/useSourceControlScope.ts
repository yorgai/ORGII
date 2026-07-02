import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";

import {
  type ScopePickerWorktreeEntry,
  type SourceControlScope,
  readSourceControlScope,
  reconcileSourceControlScope,
  scopesEqual,
  sourceControlScopeStorageKey,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/tabs/sourceControlScopePickerHelpers";
import { sourceControlScopeMapAtom } from "@src/store/workstation/codeEditor/sourceControlScopeAtom";

export interface UseSourceControlScopeOptions {
  repoPath: string;
  worktrees: ScopePickerWorktreeEntry[];
  enabled?: boolean;
  worktreesReady?: boolean;
}

export interface UseSourceControlScopeResult {
  scope: SourceControlScope;
  setScope: (scope: SourceControlScope) => void;
}

export function useSourceControlScope({
  repoPath,
  worktrees,
  enabled = true,
  worktreesReady = true,
}: UseSourceControlScopeOptions): UseSourceControlScopeResult {
  const [scopeMap, setScopeMap] = useAtom(sourceControlScopeMapAtom);
  const storageKey = useMemo(
    () => sourceControlScopeStorageKey(repoPath),
    [repoPath]
  );

  const scope = useMemo(() => {
    if (!enabled) return { kind: "local" } as const;
    return reconcileSourceControlScope(
      readSourceControlScope(scopeMap, repoPath),
      worktrees,
      { worktreesReady }
    );
  }, [enabled, scopeMap, repoPath, worktrees, worktreesReady]);

  const setScope = useCallback(
    (nextScope: SourceControlScope) => {
      if (!enabled) return;

      const reconciled = reconcileSourceControlScope(nextScope, worktrees, {
        worktreesReady,
      });
      setScopeMap((previous) => ({
        ...previous,
        [storageKey]: reconciled,
      }));
    },
    [enabled, setScopeMap, storageKey, worktrees, worktreesReady]
  );

  useEffect(() => {
    if (!enabled || !worktreesReady) return;

    const current = readSourceControlScope(scopeMap, repoPath);
    const reconciled = reconcileSourceControlScope(current, worktrees, {
      worktreesReady: true,
    });
    if (scopesEqual(current, reconciled)) return;

    setScopeMap((previous) => ({
      ...previous,
      [storageKey]: reconciled,
    }));
  }, [
    enabled,
    repoPath,
    scopeMap,
    setScopeMap,
    storageKey,
    worktrees,
    worktreesReady,
  ]);

  return { scope, setScope };
}
