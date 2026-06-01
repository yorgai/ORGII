/**
 * DeferredGitStatusProvider - PERFORMANCE OPTIMIZATION
 *
 * Defers mounting the real GitStatusProvider until after first paint.
 * This prevents API calls and event listener setup from blocking initial render.
 *
 * Behavior:
 * 1. Initially renders children with a placeholder context (loading: true)
 * 2. After first paint (via requestIdleCallback), mounts real GitStatusProvider
 * 3. Components using useGitStatus() see loading=true initially, then real data
 */
import React, { useEffect, useState } from "react";

import { GitStatusContext, GitStatusProvider } from "./GitStatusProvider";
import {
  DEFERRED_MOUNT_FALLBACK_MS,
  DEFERRED_MOUNT_TIMEOUT_MS,
} from "./constants";
import type { GitStatusContextValue } from "./types";

/**
 * Placeholder context value used before the real provider mounts.
 */
const PLACEHOLDER_CONTEXT_VALUE: GitStatusContextValue = {
  currentGitStatus: null,
  scopedGitStatus: null,
  gitSuggestedAction: null,
  loading: true,
  error: null,
  forceRefresh: async () => {
    // No-op until real provider mounts
  },
  hasActiveRepo: false,
};

export const DeferredGitStatusProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if ("requestIdleCallback" in window) {
      const idleId = requestIdleCallback(
        () => {
          setIsReady(true);
        },
        { timeout: DEFERRED_MOUNT_TIMEOUT_MS }
      );
      return () => cancelIdleCallback(idleId);
    } else {
      const timeoutId = setTimeout(() => {
        setIsReady(true);
      }, DEFERRED_MOUNT_FALLBACK_MS);
      return () => clearTimeout(timeoutId);
    }
  }, []);

  if (!isReady) {
    return (
      <GitStatusContext.Provider value={PLACEHOLDER_CONTEXT_VALUE}>
        {children}
      </GitStatusContext.Provider>
    );
  }

  return <GitStatusProvider>{children}</GitStatusProvider>;
};
