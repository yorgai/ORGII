/**
 * dnd-kit utilities for WebView/Tauri environments
 *
 * Provides scale-aware modifiers and sensors that work correctly
 * when the UI is scaled (e.g., via CSS transform or zoom).
 */
import {
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

/**
 * Gets the current UI scale from CSS variable
 * Falls back to 1 if not set
 */
export function getUiScaleFromCssVar(): number {
  if (typeof window === "undefined") return 1;

  const root = document.documentElement;
  const scaleValue = getComputedStyle(root).getPropertyValue("--ui-scale");

  if (!scaleValue || scaleValue.trim() === "") {
    return 1;
  }

  const parsed = parseFloat(scaleValue);
  return isNaN(parsed) ? 1 : parsed;
}

/**
 * Scale-aware modifier for dnd-kit
 * Corrects drag transform coordinates when UI is scaled
 */
export const scaleAwareModifier: Modifier = ({ transform }) => {
  const scale = getUiScaleFromCssVar();

  if (scale === 1) {
    return transform;
  }

  return {
    ...transform,
    x: transform.x / scale,
    y: transform.y / scale,
  };
};

/**
 * Options for useWebViewSensors hook
 */
export interface UseWebViewSensorsOptions {
  /** Distance in pixels before drag activates (default: 8) */
  activationDistance?: number;
  /** Whether to enable keyboard sensor (default: true) */
  enableKeyboard?: boolean;
}

/**
 * Custom sensors optimized for WebView/Tauri environments
 * Provides better drag behavior in scaled UIs
 */
export function useWebViewSensors(options: UseWebViewSensorsOptions = {}) {
  const { activationDistance = 8, enableKeyboard = true } = options;

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: {
      distance: activationDistance,
    },
  });

  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: (event, args) => {
      const scale = getUiScaleFromCssVar();
      const { currentCoordinates } = args;
      const step = 10 / scale;

      switch (event.code) {
        case "ArrowUp":
          return { ...currentCoordinates, y: currentCoordinates.y - step };
        case "ArrowDown":
          return { ...currentCoordinates, y: currentCoordinates.y + step };
        case "ArrowLeft":
          return { ...currentCoordinates, x: currentCoordinates.x - step };
        case "ArrowRight":
          return { ...currentCoordinates, x: currentCoordinates.x + step };
        default:
          return currentCoordinates;
      }
    },
  });

  const sensors = useSensors(
    pointerSensor,
    ...(enableKeyboard ? [keyboardSensor] : [])
  );

  return sensors;
}
