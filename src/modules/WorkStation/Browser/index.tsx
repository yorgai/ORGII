/**
 * Browser Component
 *
 * Main entry point for Browser mode (appMode === "browser").
 * Wraps BrowserLayout with ActionSystemProvider.
 *
 * Architecture:
 * - Shown when user switches to "browser" mode.
 * - BrowserLayout handles all panel orchestration
 * - Supports two modes: Browser (webview) and Designer (.orgii canvas)
 */
import React, { memo } from "react";

import { ActionSystemProvider } from "@src/ActionSystem";

import { BrowserLayout } from "./BrowserLayout";
import type { BrowserProps } from "./types";

export const Browser: React.FC<BrowserProps> = memo(
  ({ repoPath, repoName, isActive = true }) => {
    return (
      <ActionSystemProvider repoPath={repoPath} repoId={repoPath}>
        <BrowserLayout
          repoPath={repoPath}
          repoName={repoName}
          isActive={isActive}
        />
      </ActionSystemProvider>
    );
  }
);

Browser.displayName = "Browser";

export default Browser;
