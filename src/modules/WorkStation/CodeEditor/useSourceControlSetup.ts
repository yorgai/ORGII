import { useAtom, useSetAtom } from "jotai";
import React, { useCallback, useEffect, useMemo } from "react";

import type { UseGitDiffStateReturn } from "@src/hooks/workStation/git/useGitDiffState";
import {
  sourceControlFilterModeAtom,
  sourceControlFilterModeHandlerAtom,
  sourceControlFocusTargetAtom,
} from "@src/store/workstation/codeEditor";
import type {
  PanelState,
  SourceControlHistorySelection,
} from "@src/store/workstation/tabs";
import type { WorkStationTab } from "@src/store/workstation/tabs/types";
import type { GitFile } from "@src/types/git/types";

import {
  type SourceControlFilterCounts,
  SourceControlFilterHeader,
  type SourceControlFilterMode,
} from "../shared/SidebarModules";
import { useStashCount } from "./useStashCount";

interface UseSourceControlSetupParams {
  repoPath: string;
  repoId: string | null;
  gitDiffState: UseGitDiffStateReturn;
  activeTab: WorkStationTab | undefined | null;
  setPrimaryPanel: (updater: (prev: PanelState) => PanelState) => void;
  handleGitFileSelect: (file: GitFile) => void;
}

export interface UseSourceControlSetupReturn {
  sourceControlFilterMode: SourceControlFilterMode;
  sourceControlFilterCounts: SourceControlFilterCounts;
  sourceControlHeaderFilter: React.ReactNode;
  tabSidebarExtraContext: {
    surface: {
      sourceControl: {
        filterMode: SourceControlFilterMode;
        navigateWithoutSelecting: boolean;
      };
    };
  };
  handleGitFilesChange: (files: GitFile[], scopeRepoRoot?: string) => void;
  handleSourceControlHistorySelectionChange: (
    selection: SourceControlHistorySelection
  ) => void;
  handleDiffSidebarFileSelect: (file: GitFile) => void;
}

export function useSourceControlSetup({
  repoPath,
  repoId,
  gitDiffState,
  activeTab,
  setPrimaryPanel,
  handleGitFileSelect,
}: UseSourceControlSetupParams): UseSourceControlSetupReturn {
  const setSourceControlFocusTarget = useSetAtom(sourceControlFocusTargetAtom);
  const [sourceControlFilterMode, setSourceControlFilterMode] = useAtom(
    sourceControlFilterModeAtom
  );

  const { filesByPath: gitFilesByPath } = gitDiffState.state;
  const clearGitDiffFiles = gitDiffState.clearFiles;

  useEffect(() => {
    clearGitDiffFiles();
    setSourceControlFocusTarget(null);
  }, [clearGitDiffFiles, repoId, repoPath, setSourceControlFocusTarget]);

  const sourceControlFileCounts = useMemo<
    Pick<SourceControlFilterCounts, "uncommitted" | "unstaged" | "staged">
  >(() => {
    if (!repoPath) {
      return { uncommitted: 0, unstaged: 0, staged: 0 };
    }
    const files = Array.from(gitFilesByPath.values()).filter(
      (file) => file.repoRoot === repoPath
    );
    const staged = files.filter((file) => file.staged).length;
    return {
      uncommitted: files.length,
      unstaged: files.length - staged,
      staged,
    };
  }, [gitFilesByPath, repoPath]);

  const sourceControlStashCount = useStashCount({
    repoPath,
    repoId: repoId ?? undefined,
  });

  const sourceControlFilterCounts = useMemo<SourceControlFilterCounts>(
    () => ({
      ...sourceControlFileCounts,
      stashed: sourceControlStashCount,
    }),
    [sourceControlFileCounts, sourceControlStashCount]
  );

  const handleSourceControlHeaderRefresh = useCallback(() => {}, []);

  const handleSourceControlFilterModeChange = useCallback(
    (mode: SourceControlFilterMode) => {
      setSourceControlFilterMode(mode);
      if (mode === "history") return;
      setPrimaryPanel((prev: PanelState) => {
        const tabIndex = prev.tabs.findIndex(
          (item) => item.type === "source-control"
        );
        if (tabIndex === -1) return prev;
        const existing = prev.tabs[tabIndex];
        const nextStaged = mode === "staged";
        const nextFileCount = sourceControlFilterCounts[mode];
        const shouldUpdateStaged = existing.data.staged !== nextStaged;
        const shouldUpdateFileCount = existing.data.fileCount !== nextFileCount;
        const shouldClearHistory = Boolean(existing.data.historySelection);
        if (
          !shouldUpdateStaged &&
          !shouldUpdateFileCount &&
          !shouldClearHistory
        ) {
          return prev;
        }
        const nextTabs = [...prev.tabs];
        nextTabs[tabIndex] = {
          ...existing,
          data: {
            ...existing.data,
            staged: nextStaged,
            fileCount: nextFileCount,
            historySelection: null,
          },
        };
        return { ...prev, tabs: nextTabs };
      });
    },
    [setPrimaryPanel, setSourceControlFilterMode, sourceControlFilterCounts]
  );

  const setSourceControlFilterModeHandler = useSetAtom(
    sourceControlFilterModeHandlerAtom
  );
  useEffect(() => {
    setSourceControlFilterModeHandler(
      () => handleSourceControlFilterModeChange
    );
    return () => setSourceControlFilterModeHandler(null);
  }, [handleSourceControlFilterModeChange, setSourceControlFilterModeHandler]);

  const sourceControlHeaderFilter = useMemo(
    () =>
      React.createElement(SourceControlFilterHeader, {
        mode: sourceControlFilterMode,
        onChangeMode: handleSourceControlFilterModeChange,
        onRefresh: handleSourceControlHeaderRefresh,
        showRefresh: false,
        counts: sourceControlFilterCounts,
      }),
    [
      handleSourceControlFilterModeChange,
      handleSourceControlHeaderRefresh,
      sourceControlFilterCounts,
      sourceControlFilterMode,
    ]
  );

  const tabSidebarExtraContext = useMemo(
    () => ({
      surface: {
        sourceControl: {
          filterMode: sourceControlFilterMode,
          navigateWithoutSelecting:
            activeTab?.type === "source-control" &&
            activeTab.data.mode === "all-changes",
        },
      },
    }),
    [activeTab, sourceControlFilterMode]
  );

  const handleSourceControlHistorySelectionChange = useCallback(
    (selection: SourceControlHistorySelection) => {
      setPrimaryPanel((prev: PanelState) => {
        const tabIndex = prev.tabs.findIndex(
          (item) => item.type === "source-control"
        );
        if (tabIndex === -1) return prev;
        const existing = prev.tabs[tabIndex];
        const nextTabs = [...prev.tabs];
        nextTabs[tabIndex] = {
          ...existing,
          data: { ...existing.data, historySelection: selection },
        };
        return { tabs: nextTabs, activeTabId: existing.id };
      });
    },
    [setPrimaryPanel]
  );

  const setGitDiffFiles = gitDiffState.setFiles;
  const handleGitFilesChange = useCallback(
    (files: GitFile[], scopeRepoRoot?: string) => {
      const filesMap = new Map(files.map((file) => [file.path, file]));
      setGitDiffFiles(filesMap, scopeRepoRoot);
    },
    [setGitDiffFiles]
  );

  const handleDiffSidebarFileSelect = useCallback(
    (file: GitFile) => {
      const effectiveRepoPath = file.repoRoot ?? repoPath;
      const absolutePath = file.path.startsWith("/")
        ? file.path
        : `${effectiveRepoPath}/${file.path}`;

      const isAllChangesView =
        activeTab?.type === "source-control" &&
        activeTab.data.mode === "all-changes";

      if (!isAllChangesView) {
        handleGitFileSelect(file);
        return;
      }

      gitDiffState.setFile(file.path, file);
      setSourceControlFocusTarget({ path: absolutePath, nonce: Date.now() });
    },
    [
      activeTab,
      gitDiffState,
      handleGitFileSelect,
      repoPath,
      setSourceControlFocusTarget,
    ]
  );

  return {
    sourceControlFilterMode,
    sourceControlFilterCounts,
    sourceControlHeaderFilter,
    tabSidebarExtraContext,
    handleGitFilesChange,
    handleSourceControlHistorySelectionChange,
    handleDiffSidebarFileSelect,
  };
}
