/**
 * useRepoDropdownActions Hook
 *
 * Handles repository creation and import actions for repo dropdowns.
 * Opens GlobalSpotlight for repo operations (new, import, clone).
 */
import { open } from "@tauri-apps/plugin-dialog";
import { useSetAtom } from "jotai";
import { useState } from "react";

import { spotlightOpenAtom } from "@src/store";
import { showGitActionDialogSafely } from "@src/util/dialogs/gitActionDialog";

// ============================================
// Type Definitions
// ============================================

/**
 * Return type for useRepoDropdownActions
 */
export interface UseRepoDropdownActionsReturn {
  // State
  repoModalMode: "local" | "empty";
  folderPath: string;
  repoName: string;

  // Setters
  setRepoModalMode: (mode: "local" | "empty") => void;
  setFolderPath: (path: string) => void;
  setRepoName: (name: string) => void;

  // Handlers - Dropdown options
  handleEmptyRepo: () => void;
  handleLocalRepo: () => void;
  handleOpenCloneModal: () => void;
  handleSelectLocation: () => Promise<void>;
}

// ============================================
// Hook Implementation
// ============================================

/**
 * Hook for handling repo dropdown actions (create, import, clone)
 *
 * Opens GlobalSpotlight for all repo operations.
 */
export function useRepoDropdownActions(): UseRepoDropdownActionsReturn {
  const setSpotlightOpen = useSetAtom(spotlightOpenAtom);

  // State
  const [repoModalMode, setRepoModalMode] = useState<"local" | "empty">(
    "local"
  );
  const [folderPath, setFolderPath] = useState("");
  const [repoName, setRepoName] = useState("Select a source (import)");

  /**
   * Handle local folder selection for repo import
   */
  const handleSelectLocation = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Repo Location",
      });

      if (selected) {
        const selectedPath = selected as string;

        // Validate path
        if (!selectedPath || selectedPath.trim() === "") {
          showGitActionDialogSafely("Invalid path selected", "error");
          return;
        }

        setFolderPath(selectedPath);

        // Extract repo name from path
        const pathParts = selectedPath.split(/[/\\]/);
        const folderName = pathParts[pathParts.length - 1] || "Local Repo";

        setRepoName(folderName);
      }
    } catch (error) {
      console.error("[useRepoDropdownActions] Error selecting folder:", error);
      showGitActionDialogSafely("Failed to select folder location", "error");
    }
  };

  /**
   * Handle "New repo" option - opens GlobalSpotlight
   */
  const handleEmptyRepo = () => {
    setRepoModalMode("empty");
    setSpotlightOpen(true);
  };

  /**
   * Handle "Existing repo" option - opens GlobalSpotlight
   */
  const handleLocalRepo = () => {
    setRepoModalMode("local");
    setSpotlightOpen(true);
  };

  /**
   * Handle "Clone repo" option - opens GlobalSpotlight
   */
  const handleOpenCloneModal = () => {
    setSpotlightOpen(true);
  };

  return {
    // State
    repoModalMode,
    folderPath,
    repoName,

    // Setters
    setRepoModalMode,
    setFolderPath,
    setRepoName,

    // Handlers - Dropdown options
    handleEmptyRepo,
    handleLocalRepo,
    handleOpenCloneModal,
    handleSelectLocation,
  };
}

export default useRepoDropdownActions;
