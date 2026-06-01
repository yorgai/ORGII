import { useAtomValue } from "jotai";
import React, { memo, useMemo } from "react";

import BrowserCore from "@src/engines/BrowserCore";
import { useBrowserContextAdapter } from "@src/engines/BrowserCore/hooks/useBrowserContextAdapter";
import { webviewOverlayBlockedAtom } from "@src/store/ui/overlayAtom";

import { activeSharedBrowserHostAtom } from "./sharedBrowserHostAtoms";

const OFFSCREEN_STYLE: React.CSSProperties = {
  position: "fixed",
  left: -10000,
  top: -10000,
  width: 1,
  height: 1,
  pointerEvents: "none",
  overflow: "hidden",
};

export const SharedBrowserApp: React.FC = memo(() => {
  const browserState = useBrowserContextAdapter();
  const activeHost = useAtomValue(activeSharedBrowserHostAtom);
  const isWebviewBlocked = useAtomValue(webviewOverlayBlockedAtom);

  const activeRect = activeHost?.rect ?? null;
  const hasBrowserSessions = browserState.sessions.length > 0;
  const hostStyle = useMemo<React.CSSProperties>(() => {
    if (!activeRect) return OFFSCREEN_STYLE;
    return {
      position: "fixed",
      left: Math.round(activeRect.x),
      top: Math.round(activeRect.y),
      width: Math.round(activeRect.width),
      height: Math.round(activeRect.height),
      pointerEvents: "none",
      overflow: "hidden",
      zIndex: 0,
    };
  }, [activeRect]);

  return (
    <div aria-hidden="true" style={hostStyle}>
      {hasBrowserSessions && (
        <BrowserCore
          browserState={browserState}
          respectModalBlocking={false}
          hidden={!activeRect || isWebviewBlocked}
          manageWebviews
          bypassStationModeBlocking
        />
      )}
    </div>
  );
});

SharedBrowserApp.displayName = "SharedBrowserApp";

export default SharedBrowserApp;
