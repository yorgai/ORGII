/**
 * Orgii Main Layout Component
 *
 * Orchestrates providers and delegates layout to AppLayout.
 * All layout logic consolidated in layouts/shared/AppLayout.tsx
 *
 * CRITICAL ARCHITECTURE for View Mode Persistence:
 * - WorkStation (Workstation view): Always mounted, visibility controlled by CSS
 *   (includes Code Editor, Browser, Database, Chat, Project Manager)
 * - MainApp: Rendered via Outlet (route-based)
 * - This ensures WorkStation state survives view mode switches
 *
 * WebGL Performance:
 * - GlobalToolbar (with WebGL Liquid Glass): STABLE layer - never re-renders
 * - SidebarSelector: DYNAMIC layer - changes per route
 * - ChatPanel: STABLE layer - stays mounted across view switches
 */
import { registerAppActions } from "@/src/ActionSystem/registerAppActions";
import { useAtomValue, useSetAtom } from "jotai";
import React, {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { getColorPairById } from "@src/config/appearance/backgroundColorPairs";
import { useRouteViewMode } from "@src/config/routeViewModeConfig";
import { BrowserProvider, TerminalProvider } from "@src/contexts/workstation";
import { useServiceAuthState } from "@src/hooks/auth";
import { useProjectDataChangedListener } from "@src/hooks/project";
import { useBackgroundImage } from "@src/hooks/theme/useBackgroundImage";
import { useOpenUrlInBrowser } from "@src/hooks/workStation/browser/useOpenUrlInBrowser";
import { useUrlPreviewEvents } from "@src/hooks/workStation/tabs";
import { useNarrowChatFocus } from "@src/hooks/workStation/useNarrowChatFocus";
import { useGlobalBrowserWebviewLayering } from "@src/modules/WorkStation/Browser/hooks";
import { useOSAgentIDEActions } from "@src/modules/WorkStation/Browser/hooks/osagent";
import { SharedBrowserApp } from "@src/modules/WorkStation/Browser/shared";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import {
  preloadMainAppRoutes,
  preloadWingmanWindows,
} from "@src/router/lazy/preload";
import {
  activeColorPairIdAtom,
  resolvedBackgroundConfigAtom,
} from "@src/store";
import { useSyncStatusBridge } from "@src/store/sync";
import {
  type ChatPanelMode,
  chatPanelMaximizedAtom,
  chatWidthAtom,
  restoreChatWidthAtom,
  stationChatVisibilityAtom,
} from "@src/store/ui/chatPanelAtom";
import {
  DEFAULT_SIDEBAR_WIDTH,
  sidebarCollapsedAtom,
  sidebarWidthAtom,
} from "@src/store/ui/sidebarAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { globalLayoutMethodAtom } from "@src/store/ui/uiAtom";
import {
  sessionChatPositionAtom,
  workStationChatPositionAtom,
} from "@src/store/ui/workStationAtom";
import { prewarmColorPair } from "@src/util/ui/theme/glassMaterial";

import { BackgroundLayer } from "./shared/components";
import { FloatingSidebar } from "./shared/components/FloatingSidebar";
import { SidebarSelector } from "./shared/components/SidebarSelector";
import {
  useRouteLayoutType,
  useStickyMount,
  useWorkspaceEvents,
} from "./shared/hooks";
import { AppLayout } from "./shared/layouts";
import type { ChatLayout } from "./shared/layouts/AppLayout";
import {
  LAYOUT_CONTAIN_STYLE,
  VIEW_CONTAINER_CLASSES,
  getViewToggleStyle,
} from "./shared/layouts/viewContainerTokens";
import { useWorkStationPipelineBridge } from "./useWorkStationPipelineBridge";

// Lazy load persistent views for code splitting
const WorkStationPage = React.lazy(() => import("./WorkStation"));

/**
 * Main Orgii Component
 *
 * View Mode Persistence Architecture:
 * - WorkStation (Workstation view): Always mounted, visibility controlled by CSS
 * - MainApp/other routes: Rendered via Outlet (route-based)
 *
 * Performance Architecture:
 * 1. GlobalToolbar: STABLE
 * 2. SidebarSelector: DYNAMIC (changes per route, memoized)
 * 3. WorkStation: PERSISTENT (mounted once, visibility toggled)
 *
 * This ensures:
 * - WorkStation stays mounted across route switches
 * - WorkStation state survives view mode switches
 */

/** Mounts useOpenUrlInBrowser inside BrowserProvider so the hook can access BrowserContext. */
const BrowserEventBridge: React.FC = () => {
  useOpenUrlInBrowser();
  return null;
};

const AppShell = () => {
  // Router location for conditional rendering
  const location = useLocation();

  // Auth state - hide tab bar when not authenticated (e.g., login page)
  const { isAuthenticated } = useServiceAuthState();

  // Background customization config
  const backgroundConfig = useAtomValue(resolvedBackgroundConfigAtom);
  const activeColorPairId = useAtomValue(activeColorPairIdAtom);
  const currentBackgroundImage = useBackgroundImage();

  // === Prewarm glass-material cache for both sides of the active color pair ===
  // The first theme flip is otherwise slow because every glass surface (toolbar,
  // sidebar, tabbar, content, …) independently misses the sync cache for the
  // newly-active appearance and falls into the async resolver. The color path
  // is fully synchronous, so warming both `light` and `dark` upfront makes
  // every subsequent flip hit the sync cache instantly.
  useEffect(() => {
    if (!activeColorPairId) return;
    const pair = getColorPairById(activeColorPairId);
    if (!pair) return;
    prewarmColorPair(pair.light, pair.dark);
  }, [activeColorPairId]);

  // View mode from route (sync) - prevents flash during transitions
  const viewMode = useRouteViewMode();

  // WorkStation is always mounted for persistence
  // Visibility is controlled via CSS, not mounting/unmounting

  // === App-Level Action Registration ===
  // Registers navigation, theme, sidebar, tabs, spotlight actions globally.
  // These are available to the OS agent and any component via zodActionRegistry.
  useEffect(() => {
    const cleanup = registerAppActions();
    return cleanup;
  }, []);

  // === Global Browser Webview Layering ===
  // Drops inline browser WKWebViews behind React portals whenever any
  // overlay (dropdown, modal, spotlight) is visible. See
  // `Documentation/WorkStation/Browser/webview-layering--0418.md`.
  useGlobalBrowserWebviewLayering();

  // === Preload MainApp route chunks in the background ===
  useEffect(() => {
    if (isAuthenticated) {
      preloadMainAppRoutes();
      // Warm the Wingman panel chunk so opening the secondary webview later
      // doesn't leave it blank while the bundle is being fetched.
      preloadWingmanWindows();
    }
  }, [isAuthenticated]);

  // === Navigation Bridge ===
  // App-level navigation actions dispatch CustomEvents because they can't use
  // React Router hooks (they run outside component context). This listener
  // bridges the event to the real router.
  const navigate = useNavigate();
  useEffect(() => {
    function handleNavigate(evt: Event) {
      const { path, replace } = (
        evt as CustomEvent<{ path: string; replace?: boolean }>
      ).detail;
      navigate(path, { replace });
    }
    window.addEventListener("action-system-navigate", handleNavigate);
    return () => {
      window.removeEventListener("action-system-navigate", handleNavigate);
    };
  }, [navigate]);

  // === Centralized Event Handlers (Custom Hooks) ===
  useWorkspaceEvents();
  useUrlPreviewEvents();

  // === OS Agent IDE Actions Bridge ===
  // Still mounted because `manage_session` Rust tool routes through the
  // ActionBridge for session-category zod actions (session.create /
  // session.list / session.sendMessage / ...). GUI-category actions are
  // gated off inside the hook — see GUI_DISPATCH_DISABLED in
  // useOSAgentIDEActions.ts. Re-enable GUI routing for cowork / voice mode.
  useOSAgentIDEActions();

  // === Listens for project/work-item data-change events from the Rust
  // backend (project_management::projects::events) so cached views invalidate
  // and atoms re-fetch without a manual refresh.
  useProjectDataChangedListener();

  // === Phase 4.6 Track B: live outbox-state events from the sync worker
  // (project_management::sync::events). Replaces polling
  // `projectSyncApi.status` from the settings panel + status bar.
  useSyncStatusBridge();

  // NOTE: Cmd+S (spotlight) and Cmd+I (chat) are now handled by useGlobalShortcuts

  // Check if current route supports docked chat panel
  const stationMode = useAtomValue(stationModeAtom);
  const chatPanelMaximized = useAtomValue(chatPanelMaximizedAtom);
  const stationChatVisibility = useAtomValue(stationChatVisibilityAtom);
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const sidebarWidth = useAtomValue(sidebarWidthAtom);
  const routeLayoutType = useRouteLayoutType();
  const currentStationChatVisible =
    stationMode in stationChatVisibility
      ? stationChatVisibility[stationMode as keyof typeof stationChatVisibility]
      : false;
  const setChatWidth = useSetAtom(chatWidthAtom);
  const restoreChatWidth = useSetAtom(restoreChatWidthAtom);

  // Settings-in-slot is fully URL-derived: any `/orgii/app/settings/*`
  // path swaps the chat-panel slot to render the Settings dispatcher
  // instead of the live session, and pins it to the left side of the
  // WorkStation. The slot itself fans out by route root (APP /
  // AGENT_ORGS / MY_ROLE) — from AppShell's perspective all settings
  // URLs look the same. There is no atom for this; the URL is the
  // single source of truth.
  const isSettingsRoute = location.pathname.startsWith("/orgii/app/settings");
  const chatPanelMode: ChatPanelMode = isSettingsRoute ? "settings" : "session";

  const showChatPanel = useMemo(() => {
    const path = location.pathname;
    // Settings-in-slot must stay visible even on Ops Control so the user can
    // open Settings from the Kanban surface without flipping out of it.
    if (isSettingsRoute) return true;
    if (stationMode === "ops-control") return false;
    return path.includes("/workstation");
  }, [location.pathname, isSettingsRoute, stationMode]);

  useEffect(() => {
    if (viewMode !== "workStation") return;
    if (chatPanelMaximized || stationMode === "ops-control") return;
    // Don't touch chat width while Settings-in-slot owns the slot — its
    // own fallback width (DEFAULT_CHAT_WIDTH) shouldn't be overwritten.
    if (isSettingsRoute) return;

    if (currentStationChatVisible) {
      restoreChatWidth();
    } else {
      setChatWidth(0);
    }
  }, [
    chatPanelMaximized,
    currentStationChatVisible,
    isSettingsRoute,
    restoreChatWidth,
    setChatWidth,
    stationMode,
    viewMode,
  ]);

  // Auto-maximize the chat-panel slot when the user navigates into
  // Settings, and restore the prior state when they leave — unless they
  // manually toggle maximize while in Settings, in which case respect
  // their choice on exit. Edge-triggered: only fires on the
  // session→settings and settings→session transitions, so re-rendering
  // inside settings doesn't keep re-forcing maximized.
  //
  // Uses `useLayoutEffect` so the atom write commits BEFORE the browser
  // paints the new route. Otherwise the first paint after navigating
  // into Settings briefly shows the un-maximized layout (WorkStation
  // surface visible behind the not-yet-full-width Settings slot) for one
  // frame before the post-paint effect maximizes the slot — visible as a
  // flash of WorkStation content on entry.
  const setChatPanelMaximized = useSetAtom(chatPanelMaximizedAtom);
  const settingsPriorMaximizedRef = useRef<boolean | null>(null);
  // Initialize to `false` so the very first paint into a settings URL
  // (cold start / deep link / reload mid-session) also trips the
  // session→settings edge and auto-maximizes. After the first effect
  // run this ref tracks the live previous value.
  const wasSettingsRouteRef = useRef<boolean>(false);
  useLayoutEffect(() => {
    const wasSettings = wasSettingsRouteRef.current;
    wasSettingsRouteRef.current = isSettingsRoute;
    // Use the render-time value directly (it is captured at the point
    // this effect runs, which is the same frame as the route change).
    const live = chatPanelMaximized;

    if (isSettingsRoute && !wasSettings) {
      settingsPriorMaximizedRef.current = live;
      if (!live) setChatPanelMaximized(true);
      return;
    }

    if (!isSettingsRoute && wasSettings) {
      const prior = settingsPriorMaximizedRef.current;
      settingsPriorMaximizedRef.current = null;
      if (prior !== null && prior !== live) {
        setChatPanelMaximized(prior);
      }
    }
  }, [chatPanelMaximized, isSettingsRoute, setChatPanelMaximized]);

  // Global layout method (inset/full) — drives WorkStation chat layout too
  const globalLayoutMethod = useAtomValue(globalLayoutMethodAtom);

  // `/orgii/app/settings/*` resolves to `viewMode === "workStation"`
  // (see `routeViewModeConfig`) so this captures the settings surface
  // too — no extra OR clause needed.
  const isWorkStationViewActive = viewMode === "workStation";
  // Settings-in-slot doesn't run a real chat session, so we don't bridge
  // the WorkStation pipeline atom into the docked chat there.
  const shouldBridgeWorkStationPipeline =
    isWorkStationViewActive &&
    stationMode !== "ops-control" &&
    !isSettingsRoute;

  // Auto-maximize the docked chat panel when the viewport is too narrow
  // to share a row between the WorkStation tools and the chat. Restores
  // the previous mode when the viewport grows back.
  useNarrowChatFocus({ enabled: isWorkStationViewActive });

  // Keeps the pipeline atom in sync with WorkStation's remembered
  // selection whenever the primary WorkStation chat surface is visible.
  // Kanban owns secondary chat previews, so it must not reassert the
  // remembered docked-chat session into the transient pipeline.
  useWorkStationPipelineBridge(shouldBridgeWorkStationPipeline);

  // Persistent views: mount once on first visit, keep mounted forever.
  const shouldRenderWorkStation = useStickyMount(isWorkStationViewActive);

  // Should show Outlet? (only for non-persistent views). On settings routes
  // we hide the Outlet because the Settings UI is rendered inside the slot —
  // the route still resolves so deeplinks/refresh work, but its mounted
  // <Settings /> page sits behind the WorkStation surface invisibly.
  const shouldShowOutlet = !isWorkStationViewActive;

  // Chat layout mirrors the global layout method when WorkStation is
  // active, otherwise falls back to overlay. The `GlobalLayoutMethod`
  // and `ChatLayout` unions match exactly ("inset" | "full" | "compact")
  // so the value passes through directly.
  const chatLayout: ChatLayout = isWorkStationViewActive
    ? globalLayoutMethod
    : "inset";

  const workStationChatPosition = useAtomValue(workStationChatPositionAtom);
  const sessionChatPosition = useAtomValue(sessionChatPositionAtom);
  // Settings always sits on the left side of the WorkStation; the
  // position atoms only describe ChatPanel placement, not Settings.
  const chatPosition = isSettingsRoute
    ? "left"
    : stationMode === "agent-station"
      ? sessionChatPosition
      : workStationChatPosition;
  const sessionSidebarWidth =
    routeLayoutType === "session" && !sidebarCollapsed
      ? sidebarWidth || DEFAULT_SIDEBAR_WIDTH
      : 0;

  // The chat slot is maximized when the user explicitly maximizes it
  // (chat-panel header button, toolbar toggle, narrow-viewport auto-flip)
  // OR when Settings-in-slot is active — entering Settings auto-flips to
  // maximized via the effect above, so the WorkStation surface is hidden
  // by default and the user can still un-maximize to reveal it. Ops
  // Control still suppresses the overlay unless Settings is the slot
  // occupant.
  const effectiveChatFocus =
    chatPanelMaximized &&
    isWorkStationViewActive &&
    (stationMode !== "ops-control" || isSettingsRoute);

  // Persistent providers at top level so state survives navigation
  return (
    <TerminalProvider>
      <BrowserProvider>
        <BrowserEventBridge />
        <SharedBrowserApp />
        <div className="relative flex h-full">
          {/* Background layer */}
          <BackgroundLayer
            image={
              backgroundConfig.backgroundColor ? null : currentBackgroundImage
            }
            blurAmount={backgroundConfig.blurAmount ?? 0}
            backgroundColor={backgroundConfig.backgroundColor}
            animation={backgroundConfig.animation}
            liquidGlass={backgroundConfig.liquidGlass}
          />

          {/* Main layout with sidebar, toolbar, content, and chat panel */}
          <AppLayout
            sidebar={<SidebarSelector />}
            floatingSidebar={<FloatingSidebar />}
            showChatPanel={showChatPanel}
            contentPadding={isWorkStationViewActive}
            chatLayout={chatLayout}
            chatPosition={chatPosition}
            chatPanelMaximized={effectiveChatFocus}
            chatPanelMode={chatPanelMode}
            sessionSidebarWidth={sessionSidebarWidth}
          >
            <div className="relative h-full w-full min-w-0">
              {/* WorkStation — deferred until first visit, then kept mounted */}
              {shouldRenderWorkStation && (
                <div
                  className={
                    globalLayoutMethod === "compact"
                      ? VIEW_CONTAINER_CLASSES.compactWithBg
                      : globalLayoutMethod === "full"
                        ? VIEW_CONTAINER_CLASSES.fullWithBg
                        : VIEW_CONTAINER_CLASSES.insetWithBg
                  }
                  style={getViewToggleStyle(isWorkStationViewActive)}
                >
                  <Suspense fallback={<Placeholder variant="loading" />}>
                    <WorkStationPage
                      isActive={isWorkStationViewActive}
                      chatPanelFocused={effectiveChatFocus}
                      isFullMode={
                        globalLayoutMethod === "full" ||
                        globalLayoutMethod === "compact"
                      }
                    />
                  </Suspense>
                </div>
              )}

              {/* Other routes (mainApp, session lifecycle) - via Outlet */}
              <div
                className="h-full w-full min-w-0"
                style={{
                  ...getViewToggleStyle(shouldShowOutlet),
                  ...LAYOUT_CONTAIN_STYLE,
                }}
              >
                <Outlet />
              </div>
            </div>
          </AppLayout>
        </div>
      </BrowserProvider>
    </TerminalProvider>
  );
};

export default AppShell;
