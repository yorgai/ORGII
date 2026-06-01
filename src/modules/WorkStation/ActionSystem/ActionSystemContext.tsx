/**
 * ActionSystemContext
 *
 * React context that provides the action dispatcher to all components.
 * Unifies human clicks and AI commands through the same dispatch pipeline.
 *
 * Uses Zod-based actions registered via registerCoreActions.
 * Services are singletons that access Jotai atoms directly (no hook dependencies).
 *
 * Features:
 * - AI action visualization (shows highlight, cursor, toast for AI actions)
 * - Convention-based element targeting (no registry needed)
 * - Zod schema validation
 * - GUIAgent logging
 *
 * Convention:
 * - Elements have data-action="actionType" (e.g., data-action="editor.tab.switch")
 * - Optional data-action-id="value" for dynamic targeting
 */
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "react";

import {
  AIActionVisualizer,
  AI_VISUALIZER_CONFIG,
  getGlobalVisualizer,
} from "@src/components/AIActionVisualizer";
import { GUIAgentService } from "@src/services";

import {
  cleanupServices,
  initializeServices,
  registerCoreActions,
} from "./registration/registerCoreActions";
import { zodActionRegistry } from "./schema/zodRegistry";
import type { ActionResult } from "./types";

// ============================================
// Typed Dispatch Function
// ============================================

/**
 * Type-safe dispatch function
 * All action validation now happens via Zod schemas at runtime
 */
export interface TypedDispatch {
  (
    type: string,
    payload?: Record<string, unknown>,
    source?: "user" | "ai" | "system"
  ): Promise<ActionResult>;
}

// ============================================
// Context Types
// ============================================

export interface ActionSystemContextValue {
  /** Type-safe dispatch function */
  dispatch: TypedDispatch;
  /** Get all registered action IDs */
  getActionIds: () => string[];
  /** Check if an action type is valid */
  isValidAction: (type: string) => boolean;
}

export interface ActionSystemProviderProps {
  children: ReactNode;
  repoPath: string;
  repoId?: string;
}

// ============================================
// Context
// ============================================

const ActionSystemContext = createContext<ActionSystemContextValue | null>(
  null
);

// ============================================
// Provider
// ============================================

export function ActionSystemProvider({
  children,
  repoPath,
  repoId,
}: ActionSystemProviderProps) {
  // Register actions on mount — deferred to avoid blocking the main thread
  // during initial render (action registration is not needed for first paint).
  useEffect(() => {
    let cleanupFn: (() => void) | null = null;

    const scheduleIdle =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback
        : (cb: () => void) => setTimeout(cb, 50);

    const cancelIdle =
      typeof cancelIdleCallback === "function"
        ? cancelIdleCallback
        : clearTimeout;

    const idleHandle = scheduleIdle(() => {
      // Initialize services (with optional repoId for git API operations)
      initializeServices(repoPath, repoId).then(() => {});

      // Register all core actions with the global registry
      // Uses ref counting: first provider registers, subsequent ones just increment count
      cleanupFn = registerCoreActions(repoPath);
    });

    return () => {
      cancelIdle(idleHandle as number);
      cleanupFn?.();
      cleanupServices();
    };
  }, [repoPath, repoId]);

  /**
   * Trigger AI visualization before action execution
   * Shows highlight, cursor, and toast for AI-dispatched actions
   *
   * Uses convention-based targeting:
   * - Looks for [data-action="actionType"]
   * - If payload has id field, looks for [data-action="actionType"][data-action-id="value"]
   * - Description comes from Zod action schema
   */
  const visualizeAIAction = useCallback(
    async (
      type: string,
      payload: Record<string, unknown>
    ): Promise<boolean> => {
      const visualizer = getGlobalVisualizer();

      // Skip if no visualizer
      if (!visualizer) {
        return false;
      }

      // Get description from Zod action (if registered)
      const zodAction = zodActionRegistry.get(type);
      const description = zodAction?.meta.description ?? type;

      // Show visualization (convention-based lookup happens inside)
      visualizer.show({
        actionType: type,
        payload,
        description,
      });

      // Wait for visual delay so user can see the action
      await new Promise((resolve) =>
        setTimeout(resolve, AI_VISUALIZER_CONFIG.defaultVisualDelay)
      );

      return true;
    },
    []
  );

  /**
   * Hide visualization after action completes
   */
  const hideVisualization = useCallback(() => {
    const visualizer = getGlobalVisualizer();
    if (visualizer) {
      setTimeout(() => {
        visualizer.hide();
      }, AI_VISUALIZER_CONFIG.highlightLingerDuration);
    }
  }, []);

  // Dispatch function using Zod registry with AI visualization
  const dispatch = useCallback(
    async (
      type: string,
      payload: Record<string, unknown> = {},
      source: "user" | "ai" | "system" = "user"
    ): Promise<ActionResult> => {
      // Log the action to GUI Agent output channel
      GUIAgentService.logAction(type, payload, source);

      const startTime = performance.now();
      let didVisualize = false;

      try {
        // Trigger visualization for AI actions (before execution)
        if (source === "ai") {
          didVisualize = await visualizeAIAction(type, payload);
        }

        // Execute via Zod registry (handles validation)
        const result = await zodActionRegistry.execute(type, payload);
        const duration = performance.now() - startTime;

        // Log result to GUI Agent
        GUIAgentService.logResult(type, result, duration);

        // Hide visualization after success
        if (didVisualize) {
          hideVisualization();
        }

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Log error to GUI Agent
        GUIAgentService.logError(type, error);

        // Hide visualization on error too
        if (didVisualize) {
          hideVisualization();
        }

        if (process.env.NODE_ENV === "development") {
          console.error(`[Action] ${type} failed:`, error);
        }

        return { success: false, message };
      }
    },
    [visualizeAIAction, hideVisualization]
  );

  // Get all action IDs
  const getActionIds = useCallback(() => {
    return zodActionRegistry.getActionIds();
  }, []);

  // Check if action type is valid
  const isValidAction = useCallback((type: string): boolean => {
    return zodActionRegistry.has(type);
  }, []);

  const value = useMemo(
    () => ({
      dispatch,
      getActionIds,
      isValidAction,
    }),
    [dispatch, getActionIds, isValidAction]
  );

  return (
    <ActionSystemContext.Provider value={value}>
      {children}
      {/* AI Action Visualization overlay - renders via portal */}
      <AIActionVisualizer />
    </ActionSystemContext.Provider>
  );
}

// ============================================
// Hooks
// ============================================

/**
 * Use ActionSystem context - throws if not in provider
 */
export function useActionSystem(): ActionSystemContextValue {
  const ctx = useContext(ActionSystemContext);
  if (!ctx) {
    throw new Error("useActionSystem must be used within ActionSystemProvider");
  }
  return ctx;
}

/**
 * Optionally use ActionSystem context - returns null if not in provider.
 * Use this in shared hooks that may be used outside ActionSystemProvider.
 */
export function useActionSystemOptional(): ActionSystemContextValue | null {
  return useContext(ActionSystemContext);
}
