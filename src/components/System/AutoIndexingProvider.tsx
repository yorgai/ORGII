import { useAtomValue } from "jotai";
import React from "react";

import { useAutoIndexing } from "@src/hooks/workStation/indexing";
import { selectedRepoPathAtom } from "@src/store/repo";
import { chatPanelSelectedWorkspaceAtom } from "@src/store/ui/chatPanelAtom";

/**
 * Mounts the code-map auto-indexing scheduler. Observes the active workspace
 * (folder or git repo) and triggers a one-shot index when it is missing/stale
 * and auto-indexing is enabled. Renders nothing.
 */
export const AutoIndexingProvider: React.FC = () => {
  const selectedWorkspace = useAtomValue(chatPanelSelectedWorkspaceAtom);
  const selectedRepoPath = useAtomValue(selectedRepoPathAtom);

  // Prefer the explicit workspace path (covers non-git folder workspaces);
  // fall back to the selected git repo path.
  const workspacePath = selectedWorkspace?.path || selectedRepoPath || null;

  useAutoIndexing({ workspacePath });

  return null;
};

export default AutoIndexingProvider;
