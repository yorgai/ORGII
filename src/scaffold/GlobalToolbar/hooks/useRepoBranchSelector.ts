/**
 * useRepoBranchSelector Hook
 *
 * Handles toolbar repo/branch pill behavior. The pills now open the main
 * Spotlight through URL-like route state so toolbar, status bar, and default
 * Spotlight commands all share the same embedded selector layers.
 */
import { useAtomValue, useSetAtom } from "jotai";
import {
  type MouseEvent,
  type RefObject,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createBranchSpotlightRequest,
  createWorkspaceSpotlightRequest,
} from "@src/scaffold/GlobalSpotlight/openSpotlight";
import { spotlightOpenAtom } from "@src/store";
import { spotlightInitialQueryAtom } from "@src/store/ui/uiAtom";

import type { RepoOption } from "../types";

type ActiveSelector = "repo" | "branch" | null;

export interface UseRepoBranchSelectorOptions {
  repos: RepoOption[];
}

export interface UseRepoBranchSelectorReturn {
  toolbarContainerRef: RefObject<HTMLDivElement>;
  setSpotlightOpen: (value: boolean) => void;
  repoDropdownOptions: Array<{
    label: string;
    value: string;
    subLabel: string;
    kind?: string;
  }>;
  handleSparklesClick: () => void;
  handleRepoClick: (event: MouseEvent) => void;
  handleBranchClick: (event: MouseEvent) => void;
  activeSelector: ActiveSelector;
}

export function useRepoBranchSelector(
  options: UseRepoBranchSelectorOptions
): UseRepoBranchSelectorReturn {
  const { repos } = options;
  const spotlightOpen = useAtomValue(spotlightOpenAtom);
  const setSpotlightOpen = useSetAtom(spotlightOpenAtom);
  const setSpotlightInitialQuery = useSetAtom(spotlightInitialQueryAtom);
  const toolbarContainerRef = useRef<HTMLDivElement>(null);
  const [activeSelector, setActiveSelector] = useState<ActiveSelector>(null);

  const parseRepoDisplayName = useCallback((repo: RepoOption) => {
    let displayName = repo.name;
    const subLabel = repo.repo_url ? "GitHub" : "Local";
    if (repo.repo_url) {
      try {
        const urlParts = repo.repo_url.split("/");
        if (urlParts.length >= 2) {
          const repoName = urlParts[urlParts.length - 1].replace(/\.git$/, "");
          displayName = repoName;
        }
      } catch (_error) {
        return { displayName, subLabel };
      }
    }
    return { displayName, subLabel };
  }, []);

  const repoDropdownOptions = useMemo(() => {
    return repos.map((repo) => {
      const { displayName, subLabel } = parseRepoDisplayName(repo);
      return {
        label: displayName,
        value: repo.id,
        subLabel,
        kind: repo.kind,
      };
    });
  }, [repos, parseRepoDisplayName]);

  const handleSparklesClick = useCallback(() => {
    setActiveSelector(null);
    setSpotlightInitialQuery(null);
    setSpotlightOpen(true);
  }, [setSpotlightInitialQuery, setSpotlightOpen]);

  const handleRepoClick = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      setActiveSelector("repo");
      setSpotlightInitialQuery(createWorkspaceSpotlightRequest("switch"));
      setSpotlightOpen(true);
    },
    [setSpotlightInitialQuery, setSpotlightOpen]
  );

  const handleBranchClick = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      setActiveSelector("branch");
      setSpotlightInitialQuery(createBranchSpotlightRequest());
      setSpotlightOpen(true);
    },
    [setSpotlightInitialQuery, setSpotlightOpen]
  );

  return {
    toolbarContainerRef,
    setSpotlightOpen,
    repoDropdownOptions,
    handleSparklesClick,
    handleRepoClick,
    handleBranchClick,
    activeSelector: spotlightOpen ? activeSelector : null,
  };
}

export default useRepoBranchSelector;
