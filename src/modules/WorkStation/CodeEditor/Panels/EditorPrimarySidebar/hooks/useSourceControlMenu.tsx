/**
 * useSourceControlMenu Hook
 *
 * Encapsulates git operations, ahead/behind status, and the "..." more menu
 * for the Source Control tab header. Extracted from EditorPrimarySidebar.
 */
import React, { useMemo, useState } from "react";

import { useGitStatus } from "@src/contexts/git";
import { useGitOperations } from "@src/hooks/git/useGitOperations";

import { SourceControlMoreMenu } from "../components/SourceControlMoreMenu";

export interface UseSourceControlMenuOptions {
  repoId?: string;
  repoPath: string;
}

export interface UseSourceControlMenuResult {
  sourceControlMoreMenuElement: React.ReactNode;
  moreMenuOpen: boolean;
  setMoreMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useSourceControlMenu({
  repoId,
  repoPath,
}: UseSourceControlMenuOptions): UseSourceControlMenuResult {
  const gitOps = useGitOperations({
    repoId: repoId || undefined,
    repoPath,
  });

  const { currentGitStatus } = useGitStatus();
  const headerAhead = currentGitStatus?.branch_ahead_behind?.ahead ?? 0;
  const headerBehind = currentGitStatus?.branch_ahead_behind?.behind ?? 0;
  const hasUpstream = !!currentGitStatus?.current_upstream_branch;

  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const sourceControlMoreMenuElement = useMemo(
    () => (
      <SourceControlMoreMenu
        onPull={gitOps.pull}
        onPush={() => gitOps.push()}
        onFetch={() => gitOps.fetch()}
        onSync={gitOps.sync}
        onPublish={gitOps.publish}
        hasUpstream={hasUpstream}
        ahead={headerAhead}
        behind={headerBehind}
        isLoading={gitOps.isAnyLoading}
        onOpenChange={setMoreMenuOpen}
      />
    ),
    [gitOps, hasUpstream, headerAhead, headerBehind]
  );

  return {
    sourceControlMoreMenuElement,
    moreMenuOpen,
    setMoreMenuOpen,
  };
}
