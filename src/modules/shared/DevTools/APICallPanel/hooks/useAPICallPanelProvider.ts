// ============================================
// useAPICallPanelProvider Hook
// ============================================
/**
 * useAPICallPanelProvider Hook
 *
 * Handles provider-level logic for Panel API Call:
 * - Panel visibility state
 * - API calls tracking
 * - Event listeners for keyboard shortcuts
 * - Polling for updates when panel is visible
 *
 * @example
 * const { visible, apiCalls, handleClose, handleClear } = useAPICallPanelProvider();
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearApiCalls,
  enableApiTracking,
  getApiCalls,
} from "@src/util/monitoring/apiTracker";
import type { ApiCall } from "@src/util/monitoring/apiTracker";

// ============================================
// Type Definitions
// ============================================

export interface UseAPICallPanelProviderReturn {
  visible: boolean;
  apiCalls: ApiCall[];
  handleClose: () => void;
  handleClear: () => void;
}

// ============================================
// Hook Implementation
// ============================================

export function useAPICallPanelProvider(): UseAPICallPanelProviderReturn {
  // State
  const [visible, setVisible] = useState(false);
  const [apiCalls, setApiCalls] = useState<ApiCall[]>([]);

  // Avoid updating panel state unless the panel is actually visible.
  // Without this, devtools tracking can cause heavy re-render work (and even visible UI "flash")
  // during normal app usage.
  const visibleRef = useRef<boolean>(visible);

  // Update ref in effect to avoid updating during render
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  // ============================================
  // Methods
  // ============================================

  /**
   * Update API calls list
   */
  const updateApiCalls = useCallback(() => {
    const calls = getApiCalls();
    setApiCalls(calls);
  }, []);

  /**
   * Toggle panel visibility
   */
  const togglePanel = useCallback(() => {
    setVisible((prev) => {
      const newState = !prev;
      if (newState) {
        updateApiCalls();
      }
      return newState;
    });
  }, [updateApiCalls]);

  /**
   * Handle clear all operations
   */
  const handleClear = useCallback(() => {
    clearApiCalls();
    setApiCalls([]);
  }, []);

  /**
   * Handle close panel
   */
  const handleClose = useCallback(() => {
    setVisible(false);
  }, []);

  // ============================================
  // Effects
  // ============================================

  // Initialize tracking and event listeners
  useEffect(() => {
    // Enable tracking on mount so API calls are captured before the panel is opened.
    enableApiTracking();

    // Listen for toggle event
    const handleToggle = () => {
      togglePanel();
    };

    // Listen for API call updates when panel is visible
    const handleApiCallUpdated = () => {
      if (!visibleRef.current) return;
      updateApiCalls();
    };

    window.addEventListener("toggle-panel-api-call", handleToggle);
    window.addEventListener("api-call-updated", handleApiCallUpdated);
    return () => {
      window.removeEventListener("toggle-panel-api-call", handleToggle);
      window.removeEventListener("api-call-updated", handleApiCallUpdated);
    };
  }, [togglePanel, updateApiCalls]);

  // Update calls when becoming visible
  useEffect(() => {
    if (visible) {
      // Schedule state updates asynchronously to avoid synchronous setState in effect
      const timeoutId = setTimeout(() => {
        updateApiCalls();
      }, 0);

      // Set up polling for updates while visible
      const interval = setInterval(() => {
        updateApiCalls();
      }, 500);

      return () => {
        clearTimeout(timeoutId);
        clearInterval(interval);
      };
    }
  }, [visible, updateApiCalls]);

  return {
    visible,
    apiCalls,
    handleClose,
    handleClear,
  };
}
