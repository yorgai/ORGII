/**
 * Toolbar Dynamic Section
 *
 * Handles the dynamic part of the toolbar that changes based on route.
 * Uses ready-state pattern to prevent flashing during calculation.
 *
 * Components stay mounted to prevent WebGL re-initialization.
 *
 * Route-based content:
 * - Search-only routes (Settings, Inbox, Market) → centered search cluster
 * - Other routes → GlobalRepoBranchSelector
 */
import ToolbarButton from "@/src/scaffold/GlobalToolbar/components/ToolbarButton";
import type {
  BranchOption,
  RepoOption,
} from "@/src/scaffold/GlobalToolbar/types";
import GlobalRepoBranchSelector from "@/src/scaffold/GlobalToolbar/variants/GlobalRepoBranchSelector";
import { Search } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { labelWithShortcut } from "@src/config/keyboard/shortcutDisplay";
import { ROUTES } from "@src/config/routes";
import ToolbarGlassContainer from "@src/scaffold/GlobalToolbar/components/ToolbarGlassContainer";
import { ToolbarSpotlightSearchButton } from "@src/scaffold/GlobalToolbar/components/ToolbarSpotlightSearchButton";
import { isSearchOnlyToolbarRoute } from "@src/scaffold/GlobalToolbar/utils/isSearchOnlyToolbarRoute";

// ============================================
// Main Component
// ============================================
interface ToolbarDynamicSectionProps {
  // Props for GlobalRepoBranchSelector
  repos: RepoOption[];
  selectedRepoId: string | null;
  onRepoChange: (repoId: string) => void;
  branches: BranchOption[];
  selectedBranch: string | null;
  onBranchChange: (branch: string) => void;
  onBranchRefresh: () => void;
  branchLoading: boolean;
  checkoutLoading?: boolean;
  repoLoading?: boolean; // Add loading state for repos
  isReposFresh?: boolean; // Track if repos have been initialized
  onOpenSpotlight?: () => void; // Open spotlight for adding repos
  onOpenRepoSelector?: () => void; // Open repo selector for adding repos
  /** When true, hide repo/branch text labels (icon-only mode) */
  compact?: boolean;
  /**
   * When true, the internal spotlight search button and GlobalRepoBranchSelector's
   * spotlight are hidden. Used when the parent renders its own search slot
   * (e.g. Workstation toolbar, which renders search before desk + repo).
   */
  hideSpotlightSearch?: boolean;
}

export const ToolbarDynamicSection: React.FC<ToolbarDynamicSectionProps> = ({
  repos,
  selectedRepoId,
  onRepoChange,
  branches,
  selectedBranch,
  onBranchChange,
  onBranchRefresh,
  branchLoading,
  checkoutLoading = false,
  repoLoading = false,
  isReposFresh = false,
  onOpenSpotlight,
  onOpenRepoSelector,
  compact = false,
  hideSpotlightSearch = false,
}) => {
  const { t } = useTranslation("common");
  const location = useLocation();

  const [componentReady, setComponentReady] = useState(false);

  // Check if on Workstation route (code editor, database, browser)
  const isEditorRoute = useMemo(
    () => location.pathname.startsWith("/orgii/workstation"),
    [location.pathname]
  );

  // Check if on select-repo page - show empty/neutral state
  const isSelectRepoRoute = useMemo(
    () => location.pathname === ROUTES.app.home.selectRepo.path,
    [location.pathname]
  );

  // Routes that show toolbar search on the left instead of repo/branch selector.
  const isSearchOnlyRoute = useMemo(
    () => isSearchOnlyToolbarRoute(location.pathname),
    [location.pathname]
  );

  // Search button opens GlobalSpotlight. On the code-editor route the
  // spotlight auto-lands on the Editor tab via its route-aware default
  // filter, so no special casing is needed here.
  const handleSearchClick = useCallback(() => {
    onOpenSpotlight?.();
  }, [onOpenSpotlight]);

  // Auto-set ready after initial render (fallback if onReady not implemented)
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setComponentReady(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Loading timeout - after 3 seconds, assume loading is complete (prevents infinite loading)
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const isLoadingRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const isLoading = repoLoading || !isReposFresh;

    // Only update state when loading state actually changes
    if (isLoading !== isLoadingRef.current) {
      isLoadingRef.current = isLoading;

      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (isLoading) {
        // Reset timeout when loading starts (defer to avoid synchronous setState)
        setTimeout(() => {
          setLoadingTimedOut(false);
        }, 0);

        // Set timeout to expire loading after 3 seconds
        timeoutRef.current = setTimeout(() => {
          setLoadingTimedOut(true);
        }, 3000);
      } else {
        // Reset timeout when loading completes (defer to avoid synchronous setState)
        setTimeout(() => {
          setLoadingTimedOut(false);
        }, 0);
      }
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [repoLoading, isReposFresh]);

  // Check if we're in loading/initializing state or truly have no repos
  // isReposFresh = false means repos haven't been loaded yet (initial state)
  // repoLoading = true means we're actively fetching
  // loadingTimedOut = true means we've been loading too long, show empty state
  const isInitializing =
    (!isReposFresh || repoLoading) && !loadingTimedOut && repos.length === 0;
  const hasNoRepos =
    repos.length === 0 && (isReposFresh || loadingTimedOut) && !repoLoading;

  return (
    <div
      className="toolbar-dynamic-section relative flex items-center gap-2"
      style={{ minHeight: 36 }}
    >
      {/* Chat Appearance moved to Settings > Agent Sessions */}

      {/* Regular selector - pre-rendered, always mounted */}
      <div
        style={{
          display: componentReady ? "block" : "none",
        }}
      >
        {isSearchOnlyRoute ? (
          <ToolbarSpotlightSearchButton
            onOpenSpotlight={() => onOpenSpotlight?.()}
            title={t("actions.search")}
          />
        ) : isSelectRepoRoute ? (
          /* Show clickable message on select-repo page - opens the repo selector */
          <ToolbarGlassContainer chrome="pillButton">
            <ToolbarButton
              label={t("globalToolbar.selectWorkspaceToStart")}
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("open-select-repo-selector")
                );
              }}
              title={t("globalToolbar.selectRepoToStart")}
              size="medium"
              shape="pill"
            />
          </ToolbarGlassContainer>
        ) : isInitializing ? (
          /* Show loading skeleton while repos are initializing or loading */
          <div className="flex items-center gap-2">
            {!hideSpotlightSearch && (
              <ToolbarGlassContainer chrome="roundButton">
                <ToolbarButton
                  icon={Search}
                  onClick={handleSearchClick}
                  title={
                    isEditorRoute
                      ? labelWithShortcut("Search", "spotlight_open")
                      : "Search"
                  }
                  size="medium"
                  shape="round"
                />
              </ToolbarGlassContainer>
            )}
            <ToolbarGlassContainer chrome="statusPill">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-text-2 border-t-transparent" />
                <span className="text-[13px] text-text-2">Loading...</span>
              </div>
            </ToolbarGlassContainer>
          </div>
        ) : hasNoRepos ? (
          /* Show "Add repo" message with spotlight button when repos are confirmed empty */
          <div className="flex items-center gap-2">
            {!hideSpotlightSearch && (
              <ToolbarGlassContainer chrome="roundButton">
                <ToolbarButton
                  icon={Search}
                  onClick={handleSearchClick}
                  title={
                    isEditorRoute
                      ? labelWithShortcut("Search", "spotlight_open")
                      : "Search"
                  }
                  size="medium"
                  shape="round"
                />
              </ToolbarGlassContainer>
            )}
            <ToolbarGlassContainer chrome="pillButton">
              <ToolbarButton
                label="Add repo to start"
                onClick={() => onOpenRepoSelector?.()}
                title="Add repo to start"
                size="medium"
                shape="pill"
              />
            </ToolbarGlassContainer>
          </div>
        ) : (
          /* Show repo/branch selector when repos exist */
          <GlobalRepoBranchSelector
            repos={repos}
            selectedRepoId={selectedRepoId || ""}
            onRepoChange={onRepoChange}
            branchOptions={branches}
            selectedBranch={selectedBranch || ""}
            onBranchChange={onBranchChange}
            branchLoading={branchLoading}
            checkoutLoading={checkoutLoading}
            onRefresh={onBranchRefresh}
            centered={true}
            hideSpotlight={hideSpotlightSearch}
            onSearchClick={isEditorRoute ? handleSearchClick : undefined}
            searchButtonTitle={
              isEditorRoute
                ? labelWithShortcut("Search", "spotlight_open")
                : undefined
            }
            compact={compact}
          />
        )}
      </div>

      {/* Loading skeleton while calculating */}
      {!componentReady && (
        <div className="flex items-center gap-2 px-2">
          <div className="h-9 w-48 animate-pulse rounded-full bg-gray-200/30" />
        </div>
      )}
    </div>
  );
};
