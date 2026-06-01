/**
 * GlobalToolbar
 *
 * Main top toolbar: traffic-light spacer, optional sidebar-toggle/view-mode
 * switch when the sidebar is collapsed, a centered repo/branch dynamic
 * section on main-app routes, and a right-aligned button group with the
 * per-route ellipsis menu, extra buttons, and `+` dropdown sourced from
 * `useRouteToolbarConfig`.
 *
 * Hidden entirely on workstation view — the workstation tab bar owns its
 * own chrome there. Settings routes run inside the chat-panel slot under
 * workstation view; the SettingsSlot header hosts the per-route `+`
 * dropdown directly (still sourced from `useRouteToolbarConfig`).
 */
import EllipsisDropdown from "@/src/scaffold/GlobalToolbar/components/EllipsisDropdown";
import { ToolbarDynamicSection } from "@/src/scaffold/GlobalToolbar/components/ToolbarDynamicSection";
import {
  useEllipsisMenu,
  useRouteToolbarConfig,
  useToolbarActions,
  useToolbarLayout,
} from "@/src/scaffold/GlobalToolbar/hooks";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Ellipsis, PanelLeft, Plus } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import LiquidGlassToolbar from "@src/components/LiquidGlassToolbar";
import { useRouteViewMode } from "@src/config/routeViewModeConfig";
import { ROUTES } from "@src/config/routes";
import { hasForceVisibleSidebar } from "@src/config/sidebarRegistry";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { useAppNavigation } from "@src/hooks/navigation";
import { useIsShowSidebar } from "@src/hooks/ui/sidebar/useIsShowSidebar";
import { useSidebarState } from "@src/hooks/ui/sidebar/useSidebarState";
import { useIsCompactChromeSurface } from "@src/modules/shared/layouts/useCompactLayout";
import { RepoPalette } from "@src/scaffold/GlobalSpotlight/palettes";
import { spotlightOpenAtom } from "@src/store";
import {
  ellipsisMenuOpenAtom,
  repoSelectorOpenAtom,
} from "@src/store/ui/overlayAtom";
import {
  type ViewModeType,
  viewModePreviousRouteAtom,
} from "@src/store/ui/viewModeAtom";

import { PlusDropdown } from "./components/PlusDropdown";
import ToolbarButton from "./components/ToolbarButton";
import ToolbarButtonGroup from "./components/ToolbarButtonGroup";
import { ViewModeHandler } from "./components/ViewModeHandler";
import ViewModeSwitch from "./components/ViewModeSwitch";
import { TOOLBAR_LAYOUT } from "./config";

const COMPACT_TOOLBAR_BREAKPOINT = 768;

const GlobalToolbar: React.FC = () => {
  const iconGroupRef = useRef<HTMLDivElement>(null);
  const toolbarObserverRef = useRef<ResizeObserver | null>(null);

  // Compact mode: hide repo/branch text labels when toolbar is narrow
  const [compactToolbar, setCompactToolbar] = useState(false);

  const setToolbarElement = useCallback((element: HTMLDivElement | null) => {
    toolbarObserverRef.current?.disconnect();
    toolbarObserverRef.current = null;
    if (!element) return;

    const updateWidth = (width: number) => {
      if (width <= 0) return;
      setCompactToolbar(width < COMPACT_TOOLBAR_BREAKPOINT);
    };

    updateWidth(element.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      updateWidth(width);
    });
    observer.observe(element);
    toolbarObserverRef.current = observer;
  }, []);

  useEffect(() => {
    return () => toolbarObserverRef.current?.disconnect();
  }, []);

  // === EXTRACTED HOOKS (Business Logic) ===

  // Layout state (sidebar visibility, padding, etc.)
  const { isMacOS, needsTrafficLightPadding } = useToolbarLayout();

  // Check if current page has a sidebar
  const hasSidebar = useIsShowSidebar();

  // Get sidebar state for toggle functionality
  const { isCollapsed, toggleCollapse } = useSidebarState();

  const location = useLocation();
  const sidebarIsForcedVisible = hasForceVisibleSidebar(location.pathname);
  const shouldShowCollapsedSidebarChrome =
    hasSidebar && isCollapsed && !sidebarIsForcedVisible;
  const shouldShowSidebarButton = shouldShowCollapsedSidebarChrome;
  const shouldShowViewModeSwitch = shouldShowCollapsedSidebarChrome;

  // Tabs and active tab
  // Repo management - SIMPLE hook
  const {
    repos: reposList,
    selectedRepoId,
    selectRepo: setSelectedRepoId,
    currentRepo: _currentRepo,
    branches: branchesFromManager,
    currentBranch: branchFromManager,
    selectBranch: setBranchFromManager,
    branchLoading: branchLoadingFromManager,
    checkoutLoading: checkoutLoadingFromManager,
    repoLoading: repoLoadingFromManager,
    reposLoaded: isReposFresh, // Use reposLoaded to track if load completed (even if empty)
  } = useRepoSelection({ autoLoad: false });

  // View mode state
  // IMPORTANT: Read from route synchronously to avoid 1-frame mismatch/flash during navigation.
  const viewMode = useRouteViewMode();
  const previousRoute = useAtomValue(viewModePreviousRouteAtom);

  // Navigation for view mode switching
  const { navigateTo, navigateToWorkStation } = useAppNavigation();

  /**
   * Handle view mode switch button clicks
   * Navigates directly to each view mode's canonical landing route.
   * For mainApp we also honor the `previousRoute` breadcrumb so that
   * leaving WorkStation deposits the user back where they came from
   * (e.g. the start page) instead of dropping them at the home start
   * page every time.
   */
  const handleViewModeChange = useCallback(
    (targetMode: ViewModeType) => {
      if (targetMode === viewMode) return;

      // Synchronous navigation (no `startTransition`). When leaving a tab
      // whose subtree has long-running Suspense work (notably the Source
      // Control tab's git-history / lazy diff content), wrapping `navigate`
      // in a transition can leave the route change permanently suspended:
      // `history.pushState` commits but `useLocation` never updates, so all
      // subsequent dock + view-mode clicks no-op until the user reloads.
      switch (targetMode) {
        case "mainApp":
          if (previousRoute?.startsWith("/orgii/app")) {
            navigateTo(previousRoute);
          } else {
            navigateTo(ROUTES.app.home.start.path);
          }
          break;
        case "workStation":
          navigateToWorkStation("code");
          break;
      }
    },
    [viewMode, previousRoute, navigateTo, navigateToWorkStation]
  );

  // Ellipsis menu state
  const [isEllipsisOpen, setEllipsisOpen] = useAtom(ellipsisMenuOpenAtom);

  // Spotlight state - for opening spotlight from empty repo state
  const setSpotlightOpen = useSetAtom(spotlightOpenAtom);
  const handleOpenSpotlight = useCallback(() => {
    setSpotlightOpen(true);
  }, [setSpotlightOpen]);

  // Repo selector state — atom so other modules (e.g. useRouteToolbarConfig) can trigger it
  const [isRepoSelectorOpen, setIsRepoSelectorOpen] =
    useAtom(repoSelectorOpenAtom);
  const handleOpenRepoSelector = useCallback(() => {
    setIsRepoSelectorOpen(true);
  }, [setIsRepoSelectorOpen]);

  // === COMPUTED VALUES ===

  // In compact layout the entire app sits on bg-bg-2 with no rounded inset,
  // so the toolbar follows the same surface treatment instead of floating
  // on top of the wallpaper. Wallpaper routes (start page, walkthrough,
  // repo picker) keep the bleed-through — see `useIsCompactChromeSurface`.
  const isCompactLayout = useIsCompactChromeSurface();

  // Hide chrome (repo/branch pills, etc.) on the login route itself —
  // not based on authentication state, since OSS users may use the app
  // unauthenticated via "continue without signing in".
  const isOnLoginRoute = location.pathname.startsWith(ROUTES.auth.login.path);

  const isWorkStationView = viewMode === "workStation";

  // Toolbar actions (repo/branch options, git status refresh)
  const { globalRepos, globalBranchOptions, handleGitStatusRefresh } =
    useToolbarActions({
      reposList,
      branchesFromManager,
      selectedRepoId,
    });

  // Ellipsis menu - show "Add repo" when no repos exist
  const hasNoRepos =
    globalRepos.length === 0 && isReposFresh && !repoLoadingFromManager;
  const { menuItems: defaultMenuItems } = useEllipsisMenu({
    hasNoRepos,
    onOpenRepoSelector: handleOpenRepoSelector,
  });

  // Per-route toolbar config (derived from pathname + atoms, no KeepAlive issues)
  const routeToolbarConfig = useRouteToolbarConfig();
  const menuItems = routeToolbarConfig?.ellipsisItems ?? defaultMenuItems;
  const hasEllipsisMenuItems = menuItems.length > 0;

  // Plus dropdown state (for routes with plusDropdownItems)
  const [isPlusDropdownOpen, setIsPlusDropdownOpen] = useState(false);

  // WorkStation owns its chrome in the workstation tab bar (and the
  // SettingsSlot header for settings-in-slot); the global toolbar stays
  // hidden whenever workstation view is active.
  if (isWorkStationView) {
    return null;
  }

  // === RENDER ===

  return (
    <>
      {/* Traffic Lights - Now using native macOS decorations (see tauri.conf.json) */}
      {/* Native traffic lights provide window tiling, full screen, etc. */}

      {/* Toolbar */}
      <div
        ref={setToolbarElement}
        className={`relative flex h-[52px] min-h-[52px] items-center gap-2 px-2 @container ${
          isCompactLayout ? "bg-bg-2" : ""
        }`}
        data-tauri-drag-region
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {/* Traffic Light Spacer */}
        {needsTrafficLightPadding && (
          <div
            className="flex-shrink-0"
            style={{ width: TOOLBAR_LAYOUT.trafficLightWidth }}
          />
        )}

        {/* Sidebar Toggle Button - Show when a sidebar exists and is collapsed. */}
        {isMacOS && shouldShowSidebarButton && (
          <div
            className="flex h-full items-center"
            data-toolbar-section="sidebar-toggle"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <LiquidGlassToolbar
              height={36}
              radius={100}
              padding="0"
              gap={0}
              intensity="default"
            >
              <ToolbarButton
                icon={PanelLeft}
                onClick={toggleCollapse}
                title="Expand sidebar"
                size="medium"
                shape="round"
              />
            </LiquidGlassToolbar>
          </div>
        )}

        {/* View Mode Switch — sidebar pill owns switching while sidebar is visible. */}
        {shouldShowViewModeSwitch && (
          <div
            className="flex h-full items-center"
            data-toolbar-section="view-mode-switch"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <ViewModeSwitch value={viewMode} onChange={handleViewModeChange} />
          </div>
        )}

        {/* Center: repo/branch dynamic section. Hidden on the login page,
            and on settings routes (which run under `viewMode === "workStation"`
            but don't need a repo pill). */}
        {!isOnLoginRoute && (
          <div
            className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2"
            data-toolbar-section="center-dynamic"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <ToolbarDynamicSection
              repos={globalRepos}
              selectedRepoId={selectedRepoId}
              onRepoChange={setSelectedRepoId}
              branches={globalBranchOptions}
              selectedBranch={branchFromManager}
              onBranchChange={setBranchFromManager}
              onBranchRefresh={handleGitStatusRefresh}
              branchLoading={branchLoadingFromManager}
              checkoutLoading={checkoutLoadingFromManager}
              repoLoading={repoLoadingFromManager}
              isReposFresh={isReposFresh}
              onOpenSpotlight={handleOpenSpotlight}
              onOpenRepoSelector={handleOpenRepoSelector}
              compact={compactToolbar}
              hideSpotlightSearch={false}
            />
          </div>
        )}

        {/* Right Side: Actions */}
        <div
          className="ml-auto flex h-full items-center gap-2"
          data-toolbar-section="right-actions"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div ref={iconGroupRef} className="flex items-center">
            <ToolbarButtonGroup
              items={[
                ...(hasEllipsisMenuItems
                  ? [
                      {
                        id: "menu",
                        icon: Ellipsis,
                        onClick: () => setEllipsisOpen(!isEllipsisOpen),
                        title: "More Options",
                        selected: isEllipsisOpen,
                      },
                    ]
                  : []),
                ...(routeToolbarConfig?.extraButtons ?? []),
                ...(routeToolbarConfig?.plusDropdownItems
                  ? [
                      {
                        id: "add",
                        icon: Plus,
                        onClick: () => setIsPlusDropdownOpen((prev) => !prev),
                        title: routeToolbarConfig.plusTitle ?? "Add",
                        selected: isPlusDropdownOpen,
                      },
                    ]
                  : routeToolbarConfig?.onPlusClick
                    ? [
                        {
                          id: "add",
                          icon: Plus,
                          onClick: routeToolbarConfig.onPlusClick,
                          title: routeToolbarConfig.plusTitle ?? "Add",
                        },
                      ]
                    : []),
              ]}
            />
          </div>
        </div>
      </div>

      {hasEllipsisMenuItems && (
        <EllipsisDropdown
          isOpen={isEllipsisOpen}
          onClose={() => setEllipsisOpen(false)}
          triggerRef={iconGroupRef}
          menuItems={menuItems}
        />
      )}
      {routeToolbarConfig?.plusDropdownItems && (
        <PlusDropdown
          isOpen={isPlusDropdownOpen}
          onClose={() => setIsPlusDropdownOpen(false)}
          triggerRef={iconGroupRef}
          items={routeToolbarConfig.plusDropdownItems}
        />
      )}
      {/* Repo palette - shown when "Add repo" is clicked with no repos */}
      <RepoPalette
        isOpen={isRepoSelectorOpen}
        onClose={() => setIsRepoSelectorOpen(false)}
        onSelect={(repoId) => {
          setSelectedRepoId(repoId);
          setIsRepoSelectorOpen(false);
          // When the picker is opened from the select-repo landing page
          // (or any other non-app route), updating the atom alone does not
          // leave that page; navigate to the start page so the user lands
          // back inside the main app.
          if (!location.pathname.startsWith(ROUTES.app.home.start.path)) {
            navigateTo(ROUTES.app.home.start.path);
          }
        }}
        currentRepoId={selectedRepoId || undefined}
      />

      {/* Hidden components that handle side effects */}
      <ViewModeHandler />
    </>
  );
};

export default GlobalToolbar;
