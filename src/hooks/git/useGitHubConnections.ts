/**
 * useGitHubConnections — OSS stub.
 *
 * The remote GitHub-App OAuth flow is not part of the OSS build. Users
 * authenticate to GitHub locally via PAT or SSH — see `useGitHubLocalDetect`
 * and the manual "Add Connection" UI under `Integrations > Connections >
 * Git`. This stub keeps the import surface stable: it always reports zero
 * connections and a no-op `startConnect` that points the user at the local
 * PAT/SSH flow.
 */
import { useCallback } from "react";

import type {
  GitHubBranch,
  GitHubConnection,
  GitHubRepo,
} from "@src/api/http/github/types";

const EMPTY_REPOS: GitHubRepo[] = [];
const EMPTY_BRANCHES: GitHubBranch[] = [];
const EMPTY_REPOS_CACHE = new Map<string, GitHubRepo[]>();
const EMPTY_BRANCHES_CACHE = new Map<string, GitHubBranch[]>();
const EMPTY_LOADING_REPOS = new Set<string>();
const EMPTY_LOADING_BRANCHES = new Set<string>();

export interface UseGitHubConnectionsOptions {
  autoFetch?: boolean;
}

export interface UseGitHubConnectionsReturn {
  connections: GitHubConnection[];
  isLoading: boolean;
  error: string | null;
  hasConnections: boolean;
  refresh: () => Promise<void>;
  startConnect: () => Promise<void>;
  getReposForConnection: (connectionId: string) => Promise<GitHubRepo[]>;
  reposCache: Map<string, GitHubRepo[]>;
  loadingRepos: Set<string>;
  getBranchesForRepo: (
    connectionId: string,
    repoFullName: string
  ) => Promise<GitHubBranch[]>;
  branchesCache: Map<string, GitHubBranch[]>;
  loadingBranches: Set<string>;
}

export function useGitHubConnections(
  _options: UseGitHubConnectionsOptions = {}
): UseGitHubConnectionsReturn {
  const refresh = useCallback(async () => {
    /* no-op */
  }, []);

  const startConnect = useCallback(async () => {
    console.warn(
      "[useGitHubConnections] GitHub App OAuth flow is disabled. " +
        "Use a local PAT/SSH credential via Integrations > Connections > Git."
    );
  }, []);

  const getReposForConnection = useCallback(
    async (_connectionId: string): Promise<GitHubRepo[]> => EMPTY_REPOS,
    []
  );

  const getBranchesForRepo = useCallback(
    async (
      _connectionId: string,
      _repoFullName: string
    ): Promise<GitHubBranch[]> => EMPTY_BRANCHES,
    []
  );

  return {
    connections: [],
    isLoading: false,
    error: null,
    hasConnections: false,
    refresh,
    startConnect,
    getReposForConnection,
    reposCache: EMPTY_REPOS_CACHE,
    loadingRepos: EMPTY_LOADING_REPOS,
    getBranchesForRepo,
    branchesCache: EMPTY_BRANCHES_CACHE,
    loadingBranches: EMPTY_LOADING_BRANCHES,
  };
}

export default useGitHubConnections;
