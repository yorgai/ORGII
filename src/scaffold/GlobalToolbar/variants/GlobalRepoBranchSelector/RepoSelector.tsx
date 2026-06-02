/**
 * RepoSelector Component
 *
 * Repo selection UI - now uses optimized PillSelector.
 * Shows Code icon for git repos, Folder icon for work folders.
 * When a multi-root workspace is active, shows the workspace name
 * with a FolderTree icon instead of the individual repo.
 */
import { useAtomValue } from "jotai";
import { Code, Folder, FolderTree } from "lucide-react";
import React, { useMemo } from "react";

import { CODE_EDITOR_TOUR_TARGETS } from "@src/scaffold/Tutorials/codeEditorTourConfig";
import { REPO_KIND } from "@src/store/repo";
import { isMultiRootWorkspaceAtom } from "@src/store/ui/workspaceFoldersAtom";
import { workspaceNameAtom } from "@src/store/workspace/derived";

import PillSelector from "../../components/PillSelector";

interface RepoSelectorProps {
  repoDropdownOptions: Array<{
    label: string;
    value: string;
    subLabel: string;
    kind?: string;
  }>;
  selectedRepoId: string;
  handleRepoClick: (e: React.MouseEvent) => void;
  /** When true, hide text label and show only the icon */
  compact?: boolean;
  /** Called when hover state changes */
  onHoverChange?: (hovered: boolean) => void;
  /** When true, suppress hover visuals (selector form is open) */
  formOpen?: boolean;
}

const RepoSelector: React.FC<RepoSelectorProps> = ({
  repoDropdownOptions,
  selectedRepoId,
  handleRepoClick,
  compact = false,
  onHoverChange,
  formOpen = false,
}) => {
  const isMultiRoot = useAtomValue(isMultiRootWorkspaceAtom);
  const workspaceName = useAtomValue(workspaceNameAtom);

  const selectedRepo = useMemo(
    () => repoDropdownOptions.find((repo) => repo.value === selectedRepoId),
    [repoDropdownOptions, selectedRepoId]
  );

  const label = isMultiRoot
    ? workspaceName
    : selectedRepo?.label || "Select repo";

  const icon = isMultiRoot
    ? FolderTree
    : selectedRepo?.kind === REPO_KIND.FOLDER
      ? Folder
      : Code;

  return (
    <PillSelector
      icon={icon}
      label={label}
      onClick={handleRepoClick}
      hideLabel={compact}
      onHoverChange={onHoverChange}
      formOpen={formOpen}
      dataTestId="global-repo-selector-pill"
      dataTourTarget={CODE_EDITOR_TOUR_TARGETS.repoSelector}
    />
  );
};

export default RepoSelector;
