/**
 * useOrgiiPreview - Hook for ORGII component preview
 *
 * Manages the preview webview for rendering components in isolation.
 * Communicates with Rust via Tauri invoke commands.
 *
 * @see Documentation/Architecture-Guide/orgii-editor/orgii-project-format-0130.md
 */
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

// ============================================
// Types
// ============================================

export interface PreviewState {
  status: "not_ready" | "idle" | "loading" | "ready" | "error";
  componentPath: string | null;
  componentName: string | null;
  projectName: string | null;
  args: Record<string, unknown>;
  error: string | null;
}

export interface PreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UseOrgiiPreviewOptions {
  /** Parent window label (default: "main") */
  parentWindow?: string;
  /** Webpack dev server port (default: 1998) */
  devServerPort?: number;
  /** Auto-create preview on mount */
  autoCreate?: boolean;
}

export interface UseOrgiiPreviewReturn {
  /** Current preview state */
  state: PreviewState;
  /** Whether the preview webview exists */
  isCreated: boolean;
  /** Whether preview is visible */
  isVisible: boolean;
  /** Create the preview webview */
  create: (bounds: PreviewBounds) => Promise<void>;
  /** Load a component into preview */
  loadComponent: (
    componentPath: string,
    componentName: string,
    args?: Record<string, unknown>,
    projectName?: string
  ) => Promise<void>;
  /** Update props (merge with existing) */
  updateArgs: (args: Record<string, unknown>) => Promise<void>;
  /** Set all props (replace existing) */
  setArgs: (args: Record<string, unknown>) => Promise<void>;
  /** Reset to idle state */
  reset: () => Promise<void>;
  /** Show the preview */
  show: () => Promise<void>;
  /** Hide the preview */
  hide: () => Promise<void>;
  /** Update position and size */
  updatePosition: (bounds: PreviewBounds) => Promise<void>;
  /** Close/destroy the preview */
  close: () => Promise<void>;
  /** Refresh state from webview */
  refreshState: () => Promise<void>;
  /** Inject CSS tokens into preview */
  injectCSS: (css: string) => Promise<void>;
  /** Load and inject component styles (SCSS/CSS) */
  loadComponentStyles: (
    repoPath: string,
    componentPath: string
  ) => Promise<void>;
  /** Error message if any */
  error: string | null;
}

// ============================================
// Hook
// ============================================

const DEFAULT_STATE: PreviewState = {
  status: "not_ready",
  componentPath: null,
  componentName: null,
  projectName: null,
  args: {},
  error: null,
};

export function useOrgiiPreview(
  options: UseOrgiiPreviewOptions = {}
): UseOrgiiPreviewReturn {
  const { parentWindow = "main", devServerPort = 1998 } = options;

  const [state, setState] = useState<PreviewState>(DEFAULT_STATE);
  const [isCreated, setIsCreated] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track current bounds for position updates
  const boundsRef = useRef<PreviewBounds | null>(null);

  /**
   * Create the preview webview
   */
  const create = useCallback(
    async (bounds: PreviewBounds) => {
      try {
        setError(null);
        boundsRef.current = bounds;

        await invoke("create_orgii_preview", {
          parentWindow,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          devServerPort,
        });

        setIsCreated(true);
        setIsVisible(true);

        // Wait for preview to be ready, then get initial state
        await new Promise((resolve) => setTimeout(resolve, 500));
        // Inline refreshState to avoid circular dependency
        const initialState = await invoke<PreviewState>(
          "orgii_preview_get_state"
        );
        setState(initialState);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[useOrgiiPreview] Failed to create:", message);
        setError(message);
      }
    },
    [parentWindow, devServerPort]
  );

  /**
   * Get state from webview
   */
  const getState = useCallback(async (): Promise<PreviewState> => {
    try {
      const result = await invoke<PreviewState>("orgii_preview_get_state");
      return result;
    } catch {
      return DEFAULT_STATE;
    }
  }, []);

  /**
   * Load a component into the preview
   */
  const loadComponent = useCallback(
    async (
      componentPath: string,
      componentName: string,
      args: Record<string, unknown> = {},
      projectName?: string
    ) => {
      try {
        setError(null);

        // Update local state optimistically
        setState((prev) => ({
          ...prev,
          status: "loading",
          componentPath,
          componentName,
          projectName: projectName ?? null,
          args,
          error: null,
        }));

        // Retry loading in case the webview's React app isn't mounted yet
        let loadAttempts = 0;
        const maxLoadAttempts = 5;
        const loadRetryDelay = 500;

        const tryLoad = async (): Promise<boolean> => {
          loadAttempts++;

          await invoke("orgii_preview_load_component", {
            componentPath,
            componentName,
            projectName: projectName ?? null,
            args,
          });

          // Wait a bit for the component to load
          await new Promise((resolve) => setTimeout(resolve, 300));

          // Check if it worked
          const newState = await getState();

          if (newState.status === "ready") {
            setState(newState);
            return true;
          }

          if (newState.status === "error") {
            setState(newState);
            return true; // Stop retrying on error
          }

          // Still loading or idle - might need to retry
          if (loadAttempts < maxLoadAttempts) {
            await new Promise((resolve) => setTimeout(resolve, loadRetryDelay));
            return tryLoad();
          }

          return false;
        };

        const success = await tryLoad();

        if (!success) {
          // Timeout - get final state
          const finalState = await getState();
          if (finalState.status === "ready" || finalState.status === "error") {
            setState(finalState);
          } else {
            setState((prev) => ({
              ...prev,
              status: "error",
              error: "Component load timeout - the preview may not be ready",
            }));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[useOrgiiPreview] Failed to load component:", message);
        setError(message);
        setState((prev) => ({
          ...prev,
          status: "error",
          error: message,
        }));
      }
    },
    [getState]
  );

  /**
   * Update args (merge with existing)
   */
  const updateArgs = useCallback(async (args: Record<string, unknown>) => {
    try {
      await invoke("orgii_preview_update_args", { args });
      setState((prev) => ({
        ...prev,
        args: { ...prev.args, ...args },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[useOrgiiPreview] Failed to update args:", message);
      setError(message);
    }
  }, []);

  /**
   * Set all args (replace existing)
   */
  const setArgs = useCallback(async (args: Record<string, unknown>) => {
    try {
      await invoke("orgii_preview_set_args", { args });
      setState((prev) => ({
        ...prev,
        args,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[useOrgiiPreview] Failed to set args:", message);
      setError(message);
    }
  }, []);

  /**
   * Reset to idle state
   */
  const reset = useCallback(async () => {
    try {
      await invoke("orgii_preview_reset");
      setState(DEFAULT_STATE);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[useOrgiiPreview] Failed to reset:", message);
      setError(message);
    }
  }, []);

  /**
   * Show the preview
   */
  const show = useCallback(async () => {
    try {
      await invoke("orgii_preview_show");
      setIsVisible(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[useOrgiiPreview] Failed to show:", message);
      setError(message);
    }
  }, []);

  /**
   * Hide the preview
   */
  const hide = useCallback(async () => {
    try {
      await invoke("orgii_preview_hide");
      setIsVisible(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[useOrgiiPreview] Failed to hide:", message);
      setError(message);
    }
  }, []);

  /**
   * Update position and size
   */
  const updatePosition = useCallback(async (bounds: PreviewBounds) => {
    try {
      boundsRef.current = bounds;
      await invoke("orgii_preview_update_position", {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      });
    } catch (err) {
      // Position updates are frequent, only log errors
      // eslint-disable-next-line no-console
      console.debug("[useOrgiiPreview] Position update failed:", err);
    }
  }, []);

  /**
   * Close the preview
   */
  const close = useCallback(async () => {
    try {
      await invoke("orgii_preview_close");
      setIsCreated(false);
      setIsVisible(false);
      setState(DEFAULT_STATE);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[useOrgiiPreview] Failed to close:", message);
      setError(message);
    }
  }, []);

  /**
   * Refresh state from webview
   */
  const refreshState = useCallback(async () => {
    const newState = await getState();
    setState(newState);
  }, [getState]);

  /**
   * Inject CSS tokens into preview
   */
  const injectCSS = useCallback(
    async (css: string) => {
      if (!isCreated) {
        console.warn(
          "[useOrgiiPreview] Cannot inject CSS - preview not created"
        );
        return;
      }

      try {
        await invoke("orgii_preview_inject_css", { css });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[useOrgiiPreview] Failed to inject CSS:", message);
        setError(message);
      }
    },
    [isCreated]
  );

  /**
   * Load and inject component styles (SCSS/CSS)
   *
   * Finds the component's style file, compiles SCSS if needed,
   * and injects the CSS into a SEPARATE style element (not tokens).
   */
  const loadComponentStyles = useCallback(
    async (repoPath: string, componentPath: string) => {
      if (!isCreated) {
        console.warn(
          "[useOrgiiPreview] Cannot load styles - preview not created"
        );
        return;
      }

      try {
        // Compile component styles via Rust
        const css = await invoke<string>("compile_component_styles", {
          repoPath,
          componentPath,
        });

        if (css && css.length > 0) {
          await invoke("orgii_preview_inject_component_css", { css });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          "[useOrgiiPreview] Failed to load component styles:",
          message
        );
        // Don't set error - missing styles shouldn't block component preview
      }
    },
    [isCreated]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Don't close on unmount - preview may be reused
      // Call close() explicitly when needed
    };
  }, []);

  return {
    state,
    isCreated,
    isVisible,
    create,
    loadComponent,
    updateArgs,
    setArgs,
    reset,
    show,
    hide,
    updatePosition,
    close,
    refreshState,
    injectCSS,
    loadComponentStyles,
    error,
  };
}

export default useOrgiiPreview;
