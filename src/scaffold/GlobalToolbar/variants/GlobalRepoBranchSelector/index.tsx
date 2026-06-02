/**
 * GlobalRepoBranchSelector - Refactored
 *
 * Reduced from 489 lines to ~150 lines by extracting subcomponents
 * Now composes RepoSelector and BranchSelector.
 *
 * Repo/branch pill: default shows repo and branch names when space allows.
 */
import { useRepoBranchSelector } from "@/src/scaffold/GlobalToolbar/hooks/useRepoBranchSelector";
import { useAtomValue } from "jotai";
import { ChevronRight } from "lucide-react";
import React, { useCallback } from "react";

import LiquidGlassToolbar from "@src/components/LiquidGlassToolbar";
import { useRepoGitInitialization } from "@src/hooks/git";
import { useRegionLuminance } from "@src/hooks/theme/useRegionLuminance";
import { backgroundImageAtom, spotlightOpenAtom } from "@src/store";
import { isMultiRootWorkspaceAtom } from "@src/store/ui/workspaceFoldersAtom";

import { ToolbarSpotlightSearchButton } from "../../components/ToolbarSpotlightSearchButton";
import type { BranchOption, RepoOption } from "../../types";
import BranchSelector from "./BranchSelector";
import RepoSelector from "./RepoSelector";

export interface GlobalRepoBranchSelectorProps {
  // Repo options
  repos: RepoOption[];
  selectedRepoId: string;
  onRepoChange: (repoId: string) => void;

  // Branch options
  branchOptions: BranchOption[];
  selectedBranch: string;
  onBranchChange: (branch: string) => void;
  branchLoading?: boolean;
  checkoutLoading?: boolean;

  // Style options
  className?: string;
  centered?: boolean; // When true, the selector will hug its content and not stretch
  hideSpotlight?: boolean; // When true, hides the spotlight search button
  compact?: boolean; // When true, hide text labels on repo/branch pills (icon-only)

  // Action callbacks
  onRefresh?: () => void;
  onRepoCreated?: (repoId?: string) => void; // Called when a new repo is created via spotlight
  onCreateBranch?: (branchName: string) => void; // Called when creating a new branch
  onDeleteBranch?: (branchName: string) => void; // Called when deleting a branch
  onSearchClick?: () => void; // Custom handler for search button (overrides default spotlight)
  searchButtonTitle?: string; // Custom title for search button
}

/**
 * GlobalRepoBranchSelector - Global repo/branch selector for the toolbar
 */
const GlobalRepoBranchSelector: React.FC<GlobalRepoBranchSelectorProps> = ({
  repos,
  selectedRepoId,
  branchOptions,
  selectedBranch,
  branchLoading = false,
  checkoutLoading = false,
  className = "",
  centered = false,
  hideSpotlight = false,
  compact = false,
  onSearchClick,
  searchButtonTitle,
}) => {
  // ============================================
  // Hooks
  // ============================================

  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId);
  const { isGitInitialized } = useRepoGitInitialization(
    selectedRepo?.id ?? undefined
  );
  const isGitRepo = isGitInitialized === true;
  const isMultiRoot = useAtomValue(isMultiRootWorkspaceAtom);
  const spotlightOpen = useAtomValue(spotlightOpenAtom);

  // Adaptive colors based on background luminance (theme-neutral)
  const backgroundConfig = useAtomValue(backgroundImageAtom);
  const { getRegion } = useRegionLuminance();
  const toolbarLuminance = getRegion("toolbar");
  const adaptiveEnabled = backgroundConfig.adaptiveColors ?? true;
  const adaptiveTextColor = adaptiveEnabled
    ? toolbarLuminance.text.text2
    : undefined;

  const {
    toolbarContainerRef,
    repoDropdownOptions,
    handleSparklesClick,
    handleRepoClick,
    handleBranchClick,
    activeSelector,
  } = useRepoBranchSelector({ repos });

  const handleRepoPillClick = useCallback(
    (event: React.MouseEvent) => {
      handleRepoClick(event);
    },
    [handleRepoClick]
  );

  const handleBranchPillClick = useCallback(
    (event: React.MouseEvent) => {
      handleBranchClick(event);
    },
    [handleBranchClick]
  );

  const branchSectionExpanded = Boolean(selectedRepoId);

  // ============================================
  // Render
  // ============================================

  return (
    <div
      ref={toolbarContainerRef}
      className={`${centered ? "inline-flex" : "flex w-full"} relative items-center justify-center gap-2 ${className}`}
      style={{ position: "relative" }}
    >
      {/* Search Button - Click to expand Spotlight (conditionally rendered) */}
      {!hideSpotlight && (
        <ToolbarSpotlightSearchButton
          onClick={onSearchClick ?? handleSparklesClick}
          title={searchButtonTitle ?? "Search"}
        />
      )}

      {/* Mode/Repo/Branch Selector */}
      <div className="inline-flex">
        <LiquidGlassToolbar
          height={36}
          radius={100}
          padding="4px"
          gap={0}
          intensity="default"
          style={{
            display: "inline-flex",
            position: "relative",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
          className="cursor-pointer"
        >
          {/* Repo Selector */}
          <RepoSelector
            repoDropdownOptions={repoDropdownOptions}
            selectedRepoId={selectedRepoId}
            handleRepoClick={handleRepoPillClick}
            compact={compact}
            formOpen={spotlightOpen && activeSelector === "repo"}
          />

          {/* Chevron + branch: hidden for work folders and workspaces */}
          {selectedRepoId && isGitRepo && !isMultiRoot && (
            <div
              aria-hidden={!branchSectionExpanded}
              className={
                "flex min-w-0 shrink-0 items-center overflow-hidden transition-[max-width,opacity] duration-200 ease-out " +
                (branchSectionExpanded
                  ? "max-w-[min(320px,70vw)] opacity-100"
                  : "pointer-events-none max-w-0 opacity-0")
              }
            >
              <div className="flex shrink-0 items-center justify-center px-0.5">
                <ChevronRight
                  size={12}
                  strokeWidth={1.75}
                  className={!adaptiveEnabled ? "text-text-2" : ""}
                  style={
                    adaptiveTextColor ? { color: adaptiveTextColor } : undefined
                  }
                />
              </div>

              <BranchSelector
                branchOptions={branchOptions}
                selectedBranch={selectedBranch}
                handleBranchClick={handleBranchPillClick}
                loading={branchLoading}
                checkoutLoading={checkoutLoading}
                compact={compact}
                formOpen={spotlightOpen && activeSelector === "branch"}
              />
            </div>
          )}
        </LiquidGlassToolbar>
      </div>
    </div>
  );
};

export default GlobalRepoBranchSelector;
