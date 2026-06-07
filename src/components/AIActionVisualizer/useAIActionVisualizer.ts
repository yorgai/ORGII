/**
 * useAIActionVisualizer Hook
 *
 * Controller for AI action visualization with convention-based element targeting.
 *
 * Convention:
 * - Elements have data-action="actionType" (e.g., data-action="editor.tab.switch")
 * - Optional data-action-id="value" for dynamic targeting
 *
 * Lookup order:
 * 1. [data-action="type"][data-action-id="id"] (if payload has common id fields)
 * 2. [data-action="type"]
 */
import { useCallback, useMemo, useRef, useState } from "react";

import { AI_VISUALIZER_CONFIG } from "./config";
import type {
  AIActionVisualizerController,
  ShowConfig,
  VisualizerState,
} from "./types";

// ============================================
// Initial State
// ============================================

const initialState: VisualizerState = {
  isActive: false,
  targetRect: null,
  description: "",
  animationType: "click",
  showCursor: true,
  showToast: true,
};

// ============================================
// Global Singleton
// ============================================

let globalVisualizer: AIActionVisualizerController | null = null;

export function setGlobalVisualizer(
  controller: AIActionVisualizerController | null
): void {
  globalVisualizer = controller;
}

export function clearGlobalVisualizer(
  controller: AIActionVisualizerController
): void {
  if (globalVisualizer === controller) {
    globalVisualizer = null;
  }
}

export function getGlobalVisualizer(): AIActionVisualizerController | null {
  return globalVisualizer;
}

// ============================================
// ID Field Detection
// ============================================

/** Common payload fields that identify a specific element */
const ID_FIELDS = [
  "tabId",
  "id",
  "path",
  "filePath",
  "name",
  "command",
] as const;

/**
 * Extract an id value from payload for dynamic targeting
 */
function extractIdFromPayload(
  payload: Record<string, unknown> | undefined
): string | null {
  if (!payload) return null;

  for (const field of ID_FIELDS) {
    const value = payload[field];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Find target element using convention-based lookup
 */
function findTargetElement(
  actionType: string,
  payload?: Record<string, unknown>
): Element | null {
  const id = extractIdFromPayload(payload);

  // Try specific selector first (with id)
  if (id) {
    // Escape special characters for CSS selector
    const escapedId = CSS.escape(id);
    const specificSelector = `[data-action="${actionType}"][data-action-id="${escapedId}"]`;
    const element = document.querySelector(specificSelector);
    if (element) return element;
  }

  // Fallback to action type only
  const genericSelector = `[data-action="${actionType}"]`;
  return document.querySelector(genericSelector);
}

// ============================================
// Hook
// ============================================

export interface UseAIActionVisualizerReturn extends AIActionVisualizerController {
  state: VisualizerState;
  updateTargetRect: () => void;
  /** Stable controller reference for global registration */
  controller: AIActionVisualizerController;
}

export function useAIActionVisualizer(): UseAIActionVisualizerReturn {
  const [state, setState] = useState<VisualizerState>(initialState);
  const targetElementRef = useRef<Element | null>(null);

  /**
   * Update target rect (for scroll/resize handling)
   */
  const updateTargetRect = useCallback(() => {
    if (targetElementRef.current) {
      setState((prev) => ({
        ...prev,
        targetRect: targetElementRef.current!.getBoundingClientRect(),
      }));
    }
  }, []);

  /**
   * Show visualization for an action
   */
  const show = useCallback((config: ShowConfig) => {
    const element = findTargetElement(config.actionType, config.payload);

    if (!element) {
      console.warn(
        `[AIVisualizer] No element found for action: ${config.actionType}`,
        "payload:",
        config.payload
      );
      // Still show toast even without element (floating feedback)
      setState({
        isActive: true,
        targetRect: null, // No element to highlight
        description: config.description || config.actionType,
        animationType: config.animationType ?? "click",
        showCursor: false, // No cursor without target
        showToast: config.showToast ?? AI_VISUALIZER_CONFIG.showToastByDefault,
      });
      return;
    }

    targetElementRef.current = element;

    // Scroll element into view if needed
    element.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });

    // Small delay for scroll to complete
    requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect();

      // Add visual class to target element
      element.classList.add("ai-action-target");

      setState({
        isActive: true,
        targetRect: rect,
        description: config.description || config.actionType,
        animationType: config.animationType ?? "click",
        showCursor:
          config.showCursor ?? AI_VISUALIZER_CONFIG.showCursorByDefault,
        showToast: config.showToast ?? AI_VISUALIZER_CONFIG.showToastByDefault,
      });
    });
  }, []);

  /**
   * Hide visualization
   */
  const hide = useCallback(() => {
    // Remove visual class from target element
    if (targetElementRef.current) {
      targetElementRef.current.classList.remove("ai-action-target");
      targetElementRef.current = null;
    }

    setState(initialState);
  }, []);

  // Create a stable controller object
  // The controller methods are already stable via useCallback
  const controller = useMemo<AIActionVisualizerController>(
    () => ({ show, hide, isActive: state.isActive }),
    [show, hide, state.isActive]
  );

  return {
    show,
    hide,
    isActive: state.isActive,
    state,
    updateTargetRect,
    controller,
  };
}
