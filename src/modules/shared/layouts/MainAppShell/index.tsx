/**
 * MainAppShell
 *
 * Provides the persistent outer container for MainApp pages.
 *
 * Driven by a single global setting (Settings > Appearance > Layout):
 * `general.globalLayoutMethod` — `"inset"`, `"full"`, or `"compact"`.
 *
 * 1. "inset" - Padded layout with full rounded corners
 *    - p-2 around the content panel
 *    - Always has rounded-page on all corners
 *
 * 2. "full" - Edge-to-edge layout that adapts to sidebar state
 *    - When sidebar visible: p-2 with full rounded-page
 *    - When sidebar hidden: no padding and edge-to-edge content
 *
 * 3. "compact" - Cursor Agent-style chrome
 *    - No padding around the content panel ever
 *    - Flat surface (no rounded corners) — entire app sits on bg-bg-2
 *    - Pairs with a sidebar that is flush with the window edge and has no
 *      radius (see SidebarBase)
 *
 * The container is ALWAYS rendered (not just as fallback), so pages
 * don't need to define their own wrappers. This prevents flash during
 * page transitions since the container never unmounts.
 */
import { useAtomValue } from "jotai";
import KeepAliveRouteOutlet from "keepalive-for-react-router";
import React, { Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { deriveRouteCacheKey } from "@src/config/mainAppPaths";
import { hasForceVisibleSidebar } from "@src/config/sidebarRegistry";
import ScrollRestorationWrapper from "@src/modules/shared/components/ScrollRestorationWrapper";
import { PAGE_PANEL_BG } from "@src/modules/shared/layouts/viewContainerTokens";
import { sidebarCollapsedAtom } from "@src/store/ui/sidebarAtom";
import { globalLayoutMethodAtom } from "@src/store/ui/uiAtom";

// ============================================
// MainAppShell Component
// ============================================

/**
 * MainAppShell - wraps all child routes with persistent container
 * Pages render INSIDE this container, so they shouldn't include p-2 or bg-bg-2
 */
const MainAppShell: React.FC = () => {
  const globalLayoutMethod = useAtomValue(globalLayoutMethodAtom);
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  // Cache key is collapsed to the "route instance" — see
  // `deriveRouteCacheKey` for the rationale. Intra-page navigation
  // (sidebar clicks, wizard query params, drill-downs) keeps the
  // same key so the KeepAlive outlet reuses the mounted tree instead
  // of remounting (which would restart every data-fetch hook and
  // flash the Suspense fallback because the lazy chunk's entry
  // component is re-resolved as a *new* instance).
  const currentKey = deriveRouteCacheKey(location.pathname);

  // Hide the *outgoing* cached node synchronously, before the
  // browser paints the intermediate frame. `keepalive-for-react`
  // removes the old node and appends the new one from a post-paint
  // `useEffect`, so between the commit and its effect the DOM still
  // renders the previous route — that's the "shadow" of the last
  // route's pane that leaks through on sidebar clicks. Forcing
  // `display: none` on any still-active-but-stale cache node here
  // eliminates that frame. The style is cleared in a `useEffect`
  // below (which runs *after* the library's effect has swapped the
  // DOM), so revisits to a cached route aren't left invisible.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeNodes = container.querySelectorAll<HTMLElement>(
      "[data-cache-key].active"
    );
    activeNodes.forEach((node) => {
      if (node.getAttribute("data-cache-key") !== currentKey) {
        node.style.display = "none";
      }
    });
  }, [currentKey]);

  // After paint: clear any inline `display: none` we applied above on
  // the node that now matches `currentKey` (this catches revisits to
  // a cached route, where the same DOM node was re-appended and still
  // carries a stale inline style from the previous hide pass).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const match = container.querySelector<HTMLElement>(
      `[data-cache-key="${CSS.escape(currentKey)}"]`
    );
    if (match && match.style.display === "none") {
      match.style.display = "";
    }
  }, [currentKey]);

  const isCompact = globalLayoutMethod === "compact";
  const sidebarIsForcedVisible = hasForceVisibleSidebar(location.pathname);
  const isEdgeMode =
    globalLayoutMethod === "full" &&
    sidebarCollapsed &&
    !sidebarIsForcedVisible;
  // Compact: edge-to-edge, no padding ever, flat surface.
  // Full edge mode fills the window when the sidebar is collapsed.
  // Otherwise, content keeps even padding on every side.
  const outerClassName = isCompact
    ? "relative flex h-full w-full flex-col overflow-hidden"
    : isEdgeMode
      ? "relative flex h-full w-full flex-col overflow-hidden"
      : "relative flex h-full w-full flex-col overflow-hidden p-2";

  const shellDragStyle = !isCompact
    ? ({ WebkitAppRegion: "drag" } as React.CSSProperties)
    : undefined;
  const innerStyle =
    !isCompact && isEdgeMode
      ? {
          borderTopRightRadius: 0,
          borderBottomRightRadius: "var(--radius-page)",
          borderBottomLeftRadius: "var(--radius-page)",
          borderTopLeftRadius: 0,
        }
      : undefined;
  const innerPanelStyle = {
    ...innerStyle,
    WebkitAppRegion: "no-drag",
  } as React.CSSProperties;

  // relative is needed for pages that use absolute positioning
  const innerClassName = `relative min-h-0 flex-1 overflow-hidden ${
    isCompact || isEdgeMode ? PAGE_PANEL_BG.flat : PAGE_PANEL_BG.rounded
  }`;

  return (
    <div
      className={outerClassName}
      data-tauri-drag-region={!isCompact || undefined}
      style={shellDragStyle}
    >
      {!isCompact && (
        <div
          className="absolute inset-x-0 top-0 z-50 h-2"
          data-tauri-drag-region
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          aria-hidden
        />
      )}
      <div
        className={innerClassName}
        style={innerPanelStyle}
        ref={containerRef}
      >
        <Suspense fallback={null}>
          <KeepAliveRouteOutlet
            max={12}
            wrapperComponent={ScrollRestorationWrapper}
            activeCacheKey={currentKey}
          />
        </Suspense>
      </div>
    </div>
  );
};

export default MainAppShell;

// ============================================
// ShellFallback Component
// ============================================

/**
 * ShellFallback - standalone fallback for routes not using MainAppShell
 * Shows the same container structure during loading (always default variant)
 */
export const ShellFallback: React.FC = () => {
  const globalLayoutMethod = useAtomValue(globalLayoutMethodAtom);
  const isCompact = globalLayoutMethod === "compact";
  const shellDragStyle = !isCompact
    ? ({ WebkitAppRegion: "drag" } as React.CSSProperties)
    : undefined;
  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden ${
        isCompact ? "" : "p-2"
      }`}
      data-tauri-drag-region={!isCompact || undefined}
      style={shellDragStyle}
    >
      {!isCompact && (
        <div
          className="absolute inset-x-0 top-0 z-50 h-2"
          data-tauri-drag-region
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          aria-hidden
        />
      )}
      <div
        className={`min-h-0 flex-1 overflow-hidden ${
          isCompact ? PAGE_PANEL_BG.flat : PAGE_PANEL_BG.rounded
        }`}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      />
    </div>
  );
};
