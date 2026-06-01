/**
 * Editor Context
 *
 * Provides repository state management across Editor page and EditorExtraSidebar
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { useSyncEditorRepos } from "@src/hooks/ui/tabs/useSyncGlobalTabs";
import { Repo } from "@src/store/repo";

// Options defined outside component to prevent re-renders
const REPO_SELECTION_OPTIONS = { autoLoad: true } as const;

interface EditorContextValue {
  repos: Repo[];
  selectedRepoId: string | null;
  currentRepo: Repo | null;
  repoLoading: boolean;
  filterValue: string;
  setFilterValue: (value: string) => void;
  selectRepo: (repoId: string) => void;
  refreshRepos: () => Promise<void>;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export const EditorProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const navigate = useNavigate();

  // Use the centralized repo manager
  // Note: REPO_MANAGER_OPTIONS is defined outside component to prevent re-renders
  const {
    repos,
    repos: _filteredRepos,
    selectedRepoId,
    selectRepo: setSelectedRepoId,
    repoLoading,
    loadRepos,
  } = useRepoSelection(REPO_SELECTION_OPTIONS);

  // Local filter state
  const [filterValue, setFilterValue] = useState<string>("");

  // ✨ Sync to global tabs state
  useSyncEditorRepos(repos, selectedRepoId);

  // Filter repos based on search
  const filteredReposList = useMemo(() => {
    if (!filterValue) return repos;
    const lowerFilter = filterValue.toLowerCase();
    return repos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(lowerFilter) ||
        repo.description?.toLowerCase().includes(lowerFilter)
    );
  }, [repos, filterValue]);

  // Get current repo
  const currentRepo = useMemo(() => {
    return repos.find((repo) => repo.id === selectedRepoId) || null;
  }, [repos, selectedRepoId]);

  // Select a repo and navigate to editor with that repo's path
  const selectRepo = useCallback(
    (repoId: string) => {
      const repo = repos.find((repoItem) => repoItem.id === repoId);
      if (repo && repo.fs_uri) {
        setSelectedRepoId(repoId);
        // Navigate to Workstation Code Editor with the repo's path
        navigate(
          `${ROUTES.workStation.code.path}?path=${encodeURIComponent(repo.fs_uri)}`
        );
      }
    },
    [repos, setSelectedRepoId, navigate]
  );

  // Refresh repos list
  const refreshRepos = useCallback(async () => {
    await loadRepos();
  }, [loadRepos]);

  // Memoize context value to prevent unnecessary re-renders of consumers
  // Note: setFilterValue is omitted from deps as it's stable from useState
  const value = useMemo<EditorContextValue>(
    () => ({
      repos: filteredReposList,
      selectedRepoId,
      currentRepo,
      repoLoading,
      filterValue,
      setFilterValue,
      selectRepo,
      refreshRepos,
    }),
    [
      filteredReposList,
      selectedRepoId,
      currentRepo,
      repoLoading,
      filterValue,
      selectRepo,
      refreshRepos,
    ]
  );

  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
};

export const useEditorContext = () => {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error("useEditorContext must be used within EditorProvider");
  }
  return context;
};

// Optional version that doesn't throw - for GlobalTabsSidebar
export const useEditorContextOptional = () => {
  return useContext(EditorContext);
};
