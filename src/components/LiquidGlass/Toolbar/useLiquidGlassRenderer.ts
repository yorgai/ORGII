/**
 * useLiquidGlassRenderer Hook
 *
 * WebGL-based liquid glass renderer for toolbar backgrounds.
 *
 * Architecture:
 * - Uses SharedGlassRenderer singleton (one WebGL2 context for all toolbars)
 * - Accepts a BackgroundSource discriminated union (image / color / none) as
 *   the single declarative input describing what should be rendered. The
 *   renderer handles all transitions internally; callers do not need to
 *   manually clear or coordinate switches.
 *
 * Two effects:
 *   1. Register/update toolbar slot (canvas, preset, radius, container)
 *   2. Push the BackgroundSource to the shared renderer
 */
import {
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { type BackgroundSource, NONE_SOURCE } from "./backgroundSource";
import { GlassPreset, TOOLBAR_GLASS_PRESET } from "./config";
import SharedGlassRenderer from "./sharedGlassRenderer";

// ============================================
// Types
// ============================================

export interface UseLiquidGlassRendererOptions {
  /** Glass effect preset */
  preset?: GlassPreset;
  /** Border radius in pixels */
  radius?: number;
  /**
   * Declarative background source. Defaults to { kind: "none" }.
   * Use useBackgroundSource() to derive this from the global background config.
   */
  source?: BackgroundSource;
  /** Whether to enable the renderer */
  enabled?: boolean;
  /**
   * Selector for the background container element. Used for UV calculation
   * when the background does not fill the entire viewport.
   */
  backgroundContainerSelector?: string;
}

export interface UseLiquidGlassRendererReturn {
  /** Ref for the canvas element */
  canvasRef: RefObject<HTMLCanvasElement>;
  /** Whether WebGL is supported */
  isSupported: boolean;
  /** Whether background texture is loaded and ready */
  isBackgroundReady: boolean;
  /** Start rendering (now managed by SharedGlassRenderer) */
  start: () => void;
  /** Stop rendering (now managed by SharedGlassRenderer) */
  stop: () => void;
}

// ============================================
// Hook Implementation
// ============================================

export function useLiquidGlassRenderer(
  options: UseLiquidGlassRendererOptions = {}
): UseLiquidGlassRendererReturn {
  const {
    preset = TOOLBAR_GLASS_PRESET,
    radius = 12,
    source = NONE_SOURCE,
    enabled = true,
    backgroundContainerSelector = '[data-background-layer="true"]',
  } = options;

  const instanceId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isBackgroundReady, setIsBackgroundReady] = useState(
    SharedGlassRenderer.isBackgroundReady()
  );

  const isSupported = SharedGlassRenderer.isSupported();

  // Effect 1: register/unregister toolbar slot + keep its config in sync.
  // Combines what used to be two separate effects (register + update) — the
  // shared renderer handles partial updates idempotently via Object.assign.
  useEffect(() => {
    if (!enabled || !canvasRef.current || !isSupported) {
      SharedGlassRenderer.unregisterToolbar(instanceId);
      return;
    }

    SharedGlassRenderer.registerToolbar({
      id: instanceId,
      canvas: canvasRef.current,
      preset,
      radius,
      backgroundContainerSelector,
      onBackgroundReady: setIsBackgroundReady,
    });

    return () => {
      SharedGlassRenderer.unregisterToolbar(instanceId);
    };
  }, [
    instanceId,
    enabled,
    isSupported,
    preset,
    radius,
    backgroundContainerSelector,
  ]);

  // Effect 2: push background source. The renderer dedups structurally and
  // handles all transitions (image -> color, color -> image, * -> none).
  useEffect(() => {
    if (!enabled) return;
    SharedGlassRenderer.setBackground(source);
  }, [source, enabled]);

  // Kept for API compatibility — render loop is fully managed by the singleton.
  const start = useCallback(() => {}, []);
  const stop = useCallback(() => {}, []);

  return {
    canvasRef,
    isSupported,
    isBackgroundReady,
    start,
    stop,
  };
}

export default useLiquidGlassRenderer;
