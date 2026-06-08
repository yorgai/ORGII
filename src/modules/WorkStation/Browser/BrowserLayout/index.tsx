/**
 * BrowserLayout
 *
 * Layout orchestrator for Browser mode. Composes:
 * - Left: BrowserPrimarySidebar (sessions + design + settings tabs)
 * - Center: WebViewport (webview)
 * - Right: WebInspector (DevTools) or DOM Editor panel
 * - Bottom: BrowserStatusBar
 *
 * Tab System Architecture:
 * - Uses centralized browserTabsAtom as single source of truth
 * - Browser sessions sync their state to the tab store
 * - All tab switching goes through useBrowserPaneState
 */
import { useAtomValue } from "jotai";
import React, {
  Suspense,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { workStationInternalLayoutModeAtom } from "@src/store/ui/workStationAtom";
import { extractSessionId } from "@src/store/workstation/browser/tabs";
import { workstationNewBrowserSessionRequestAtom } from "@src/store/workstation/workstationTabBarAtoms";

import {
  WORK_STATION_PLACEHOLDER_PAGE_BG_CLASS,
  WorkStationShell,
  buildPrimarySidebarConfig,
  buildSecondaryPanelConfig,
} from "../../shared";
import BrowserPrimarySidebar from "../Panels/BrowserPrimarySidebar";
import {
  SHARED_BROWSER_HOST,
  SHARED_BROWSER_HOST_SCOPE,
  SharedBrowserDevToolsPanel,
  SharedBrowserWorkspace,
} from "../shared";
import { AgentBrowserOverlay } from "./AgentBrowserOverlay";
import type { BrowserLayoutProps } from "./types";
import { useBrowserLayoutState } from "./useBrowserLayoutState";

// Lazy-load heavy secondary panels
const TokenManagerPanel = React.lazy(
  () => import("../Panels/BrowserMainPane/content/TokenManagerContent")
);
export type { BrowserLayoutProps } from "./types";

export const BrowserLayout: React.FC<BrowserLayoutProps> = memo(
  ({ repoPath, repoName: _repoName, isActive = true }) => {
    const state = useBrowserLayoutState({ repoPath, isActive });
    const internalLayoutMode = useAtomValue(workStationInternalLayoutModeAtom);
    const webviewBottomInsetPx = internalLayoutMode === "comfort" ? 8 : 0;

    const setDevToolsCollapsed = state.browser.setDevToolsCollapsed;
    const handleCloseDevTools = useCallback(() => {
      setDevToolsCollapsed(true);
    }, [setDevToolsCollapsed]);

    const setDevToolsPosition = state.browser.setDevToolsPosition;
    const handleToggleDevToolsPosition = useCallback(() => {
      setDevToolsPosition("toggle");
    }, [setDevToolsPosition]);

    const [devToolsPanelHeight, setDevToolsPanelHeight] = useState(300);

    // Cross-host "New Browser Tab" intent: the unified `+` menu (in both
    // All-Tabs and Browser modes) bumps
    // `workstationNewBrowserSessionRequestAtom` via
    // `requestNewBrowserSessionAtom`. We dispatch `addSession(url,
    // isPrivate)` whenever the tick advances past the value observed on
    // mount — already-pending requests do not fire retroactively when
    // the user navigates into Browser for the first time, but the URL /
    // private payload carried by the latest request is honored.
    const newSessionRequest = useAtomValue(
      workstationNewBrowserSessionRequestAtom
    );
    const lastSeenRequestTickRef = useRef<number>(newSessionRequest.tick);
    const addBrowserSession = state.browser.browserState.addSession;
    useEffect(() => {
      if (newSessionRequest.tick !== lastSeenRequestTickRef.current) {
        lastSeenRequestTickRef.current = newSessionRequest.tick;
        addBrowserSession(newSessionRequest.url, newSessionRequest.isPrivate);
      }
    }, [
      newSessionRequest.tick,
      newSessionRequest.url,
      newSessionRequest.isPrivate,
      addBrowserSession,
    ]);

    // ============================================
    // Primary sidebar config
    // ============================================

    const activeSessionId = state.showBrowserViewport
      ? state.isShowingBrowserSession
        ? extractSessionId(state.activeTab?.id ?? "")
        : state.browser.browserState.activeSessionId
      : null;

    const primarySidebarConfig = useMemo(
      () =>
        buildPrimarySidebarConfig({
          content: (
            <BrowserPrimarySidebar
              repoPath={repoPath}
              sessions={state.browser.browserState.sessions}
              activeSessionId={activeSessionId}
              onSelectSession={state.handleSelectSession}
              onNewSession={state.browser.handleNewSession}
              onNewPrivateSession={state.browser.handleNewPrivateSession}
              onCloseSession={state.handleCloseSession}
              onOpenColorTokens={state.handleOpenColorTokens}
              onOpenHistoryUrl={state.handleOpenHistoryUrl}
            />
          ),
          collapsed: state.browser.primarySidebarCollapsed,
          size: state.browser.primarySidebarWidth,
          onSizeChange: state.browser.setPrimarySidebarWidth,
          onClose: state.browser.closePrimarySidebar,
          minSize: 180,
          maxSize: 400,
        }),
      [
        repoPath,
        state.browser.browserState.sessions,
        activeSessionId,
        state.handleSelectSession,
        state.browser.handleNewSession,
        state.browser.handleNewPrivateSession,
        state.handleCloseSession,
        state.handleOpenColorTokens,
        state.handleOpenHistoryUrl,
        state.browser.primarySidebarCollapsed,
        state.browser.primarySidebarWidth,
        state.browser.setPrimarySidebarWidth,
        state.browser.closePrimarySidebar,
      ]
    );

    // ============================================
    // Main content
    // ============================================

    const mainContent = (
      <div
        className={`flex h-full min-h-0 w-full flex-col overflow-hidden ${WORK_STATION_PLACEHOLDER_PAGE_BG_CLASS}`}
      >
        <div className="relative flex-1 overflow-hidden">
          {state.hasOpenTabs &&
            state.isShowingTokenCategory &&
            state.activeTokenCategory && (
              <div className="absolute inset-0 z-20 bg-workstation-bg">
                <Suspense
                  fallback={
                    <Placeholder
                      variant="loading"
                      placement="detail-panel"
                      fillParentHeight
                      className={WORK_STATION_PLACEHOLDER_PAGE_BG_CLASS}
                    />
                  }
                >
                  <TokenManagerPanel
                    category={state.activeTokenCategory}
                    repoPath={repoPath}
                  />
                </Suspense>
              </div>
            )}

          {(!state.hasOpenTabs || state.hasBrowserSessions) && (
            <div
              className={`absolute inset-0 ${
                (state.showBrowserViewport || !state.hasOpenTabs) &&
                !state.automation.isRunning
                  ? "pointer-events-auto visible"
                  : "pointer-events-none invisible"
              }`}
            >
              <SharedBrowserWorkspace
                hostId={SHARED_BROWSER_HOST.MY_STATION}
                scope={SHARED_BROWSER_HOST_SCOPE.MY_STATION}
                active={
                  isActive &&
                  state.showBrowserViewport &&
                  !state.automation.isRunning
                }
                browserState={state.browser.browserState}
                onOpenNativeDevTools={state.browser.handleOpenNativeDevTools}
                onToggleDevToolsPane={state.browser.handleToggleDevTools}
                devToolsPaneCollapsed={state.browser.devToolsCollapsed}
                hideWebviews={!isActive || !state.showBrowserViewport}
                webviewBottomInsetPx={webviewBottomInsetPx}
                isInspectMode={state.browser.isInspectMode}
                onToggleInspectMode={state.browser.toggleInspectMode}
                placeholderActions={state.browserQuickActions}
              />
            </div>
          )}

          {state.automation.isRunning && (
            <AgentBrowserOverlay
              screenshot={state.automation.lastScreenshot}
              action={state.automation.lastAction}
              url={state.automation.currentUrl}
              isPaused={state.automation.isPaused}
              onTakeover={state.automation.takeover}
              onResume={state.automation.resume}
              onStop={state.automation.stop}
            />
          )}
        </div>
      </div>
    );

    // ============================================
    // DevTools panel — routed to right or bottom based on position
    // ============================================

    const devToolsPosition = state.browser.devToolsPosition;

    const devToolsContent = useMemo(
      () => (
        <SharedBrowserDevToolsPanel
          isCollapsed={state.browser.devToolsCollapsed}
          onToggleCollapse={state.browser.handleToggleDevTools}
          width={state.browser.devToolsPanelWidth}
          onWidthChange={state.browser.setDevToolsPanelWidth}
          entries={state.browser.entries}
          onClearEntries={state.browser.clearEntries}
          networkEntries={state.browser.networkEntries}
          onClearNetworkEntries={state.browser.clearNetworkEntries}
          errorCount={state.browser.errorCount}
          warningCount={state.browser.warningCount}
          selectedElement={state.browser.selectedElement}
          webviewLabel={state.browser.activeWebviewLabel}
          repoPath={repoPath}
          currentUrl={state.browser.currentUrl}
          position={devToolsPosition}
          onTogglePosition={handleToggleDevToolsPosition}
        />
      ),
      [
        state.browser.devToolsCollapsed,
        state.browser.handleToggleDevTools,
        state.browser.devToolsPanelWidth,
        state.browser.setDevToolsPanelWidth,
        state.browser.entries,
        state.browser.clearEntries,
        state.browser.networkEntries,
        state.browser.clearNetworkEntries,
        state.browser.errorCount,
        state.browser.warningCount,
        state.browser.selectedElement,
        state.browser.activeWebviewLabel,
        state.browser.currentUrl,
        repoPath,
        devToolsPosition,
        handleToggleDevToolsPosition,
      ]
    );

    // Secondary panel config — single mount, CSS grid relocates right/bottom.
    // Size/handler are axis-appropriate: width for right, height for bottom.
    const secondaryPanelConfig = useMemo(
      () =>
        buildSecondaryPanelConfig({
          content: devToolsContent,
          position: devToolsPosition,
          collapsed: state.browser.devToolsCollapsed,
          size:
            devToolsPosition === "right"
              ? state.browser.devToolsPanelWidth
              : devToolsPanelHeight,
          onSizeChange:
            devToolsPosition === "right"
              ? state.browser.setDevToolsPanelWidth
              : setDevToolsPanelHeight,
          onClose: handleCloseDevTools,
          minSize: devToolsPosition === "right" ? 200 : 160,
          maxSize: devToolsPosition === "right" ? 400 : 600,
        }),
      [
        devToolsContent,
        devToolsPosition,
        state.browser.devToolsCollapsed,
        state.browser.devToolsPanelWidth,
        state.browser.setDevToolsPanelWidth,
        devToolsPanelHeight,
        handleCloseDevTools,
      ]
    );

    // ============================================
    // Render
    // ============================================

    return (
      <WorkStationShell
        primarySidebarConfig={primarySidebarConfig}
        secondaryPanelConfig={secondaryPanelConfig}
        content={mainContent}
        statusBar={null}
        layoutMode={state.browser.layoutMode}
        appClassName="browser-explorer"
      />
    );
  }
);

BrowserLayout.displayName = "BrowserLayout";

export default BrowserLayout;
