/**
 * useEdgeReflection Hook
 *
 * Description: Implements Canvas 2D-based edge reflection for glass effect
 *
 * Features:
 * - Samples background colors from edge regions
 * - Creates brightened rim overlay that reacts to background
 * - WebKit-friendly (no SVG filters)
 * - Optional continuous sampling for animated backgrounds
 * - GPU-accelerated canvas rendering
 */
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// Hook configuration options
export interface UseEdgeReflectionOptions {
  /** Enable edge reflection */
  enabled?: boolean;
  /** Border radius in pixels */
  radius?: number;
  /** Rim width in pixels (default: 3) */
  rimWidth?: number;
  /** Brightness multiplier for sampled colors (default: 2.5) */
  brightness?: number;
  /** Sampling interval in ms (0 = only on mount, default: 100) */
  samplingInterval?: number;
}

// Hook return value type
export interface UseEdgeReflectionReturn {
  /** Ref to attach to the container element */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Ref to attach to the canvas element */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Whether the effect is ready to render */
  isReady: boolean;
}

// Default configuration
const DEFAULT_OPTIONS: Required<UseEdgeReflectionOptions> = {
  enabled: false,
  radius: 12,
  rimWidth: 3,
  brightness: 2.5,
  samplingInterval: 100,
};

/**
 * Brighten a color by a multiplier
 */
function brightenColor(
  r: number,
  g: number,
  b: number,
  multiplier: number
): [number, number, number] {
  return [
    Math.min(255, r * multiplier),
    Math.min(255, g * multiplier),
    Math.min(255, b * multiplier),
  ];
}

/**
 * Parse a color string (rgb, rgba, hex) to RGB values
 */
function parseColor(colorStr: string): [number, number, number] | null {
  // Handle rgb/rgba
  const rgbMatch = colorStr.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return [
      parseInt(rgbMatch[1]),
      parseInt(rgbMatch[2]),
      parseInt(rgbMatch[3]),
    ];
  }

  // Handle hex
  const hexMatch = colorStr.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }

  return null;
}

/**
 * Extract gradient colors from a CSS gradient string
 */
function extractGradientColors(
  gradientStr: string
): Array<[number, number, number]> {
  const colors: Array<[number, number, number]> = [];

  // Match rgb/rgba colors in gradient
  const rgbMatches = gradientStr.matchAll(
    /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/g
  );
  for (const match of rgbMatches) {
    colors.push([parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]);
  }

  return colors;
}

/**
 * Sample colors from background by traversing DOM hierarchy
 */
function sampleEdgeColors(
  container: HTMLDivElement,
  _radius: number,
  _rimWidth: number
): { topColor: [number, number, number]; avgColor: [number, number, number] } {
  const defaultColor: [number, number, number] = [100, 180, 220]; // Default cyan/teal

  try {
    // Traverse up the DOM to find background colors
    let element: HTMLElement | null = container;
    const foundColors: Array<[number, number, number]> = [];

    while (element && foundColors.length < 5) {
      const style = window.getComputedStyle(element);

      // Check background-image for gradients
      const bgImage = style.backgroundImage;
      if (bgImage && bgImage !== "none") {
        const gradientColors = extractGradientColors(bgImage);
        foundColors.push(...gradientColors);
      }

      // Check background-color
      const bgColor = style.backgroundColor;
      if (
        bgColor &&
        bgColor !== "transparent" &&
        bgColor !== "rgba(0, 0, 0, 0)"
      ) {
        const parsed = parseColor(bgColor);
        if (parsed) {
          foundColors.push(parsed);
        }
      }

      element = element.parentElement;
    }

    // If no colors found, check body and root
    if (foundColors.length === 0) {
      const bodyStyle = window.getComputedStyle(document.body);
      const rootStyle = window.getComputedStyle(document.documentElement);

      // Check for gradients first
      for (const style of [bodyStyle, rootStyle]) {
        const bgImage = style.backgroundImage;
        if (bgImage && bgImage !== "none") {
          foundColors.push(...extractGradientColors(bgImage));
        }
      }

      // Then solid colors
      for (const style of [bodyStyle, rootStyle]) {
        const bgColor = style.backgroundColor;
        if (bgColor && bgColor !== "transparent") {
          const parsed = parseColor(bgColor);
          if (parsed) foundColors.push(parsed);
        }
      }
    }

    // Calculate average color for the rim
    if (foundColors.length > 0) {
      // Use the most vibrant color (highest saturation)
      let mostVibrant = foundColors[0];
      let maxVibrancy = 0;

      for (const color of foundColors) {
        const [r, g, b] = color;
        // Simple vibrancy: max - min of RGB channels
        const vibrancy = Math.max(r, g, b) - Math.min(r, g, b);
        if (vibrancy > maxVibrancy) {
          maxVibrancy = vibrancy;
          mostVibrant = color;
        }
      }

      // Calculate average
      const avgR = Math.round(
        foundColors.reduce((sum, c) => sum + c[0], 0) / foundColors.length
      );
      const avgG = Math.round(
        foundColors.reduce((sum, c) => sum + c[1], 0) / foundColors.length
      );
      const avgB = Math.round(
        foundColors.reduce((sum, c) => sum + c[2], 0) / foundColors.length
      );

      return {
        topColor: mostVibrant,
        avgColor: [avgR, avgG, avgB],
      };
    }

    return { topColor: defaultColor, avgColor: defaultColor };
  } catch (error) {
    console.warn("Edge sampling failed:", error);
    return { topColor: defaultColor, avgColor: defaultColor };
  }
}

/**
 * Draw edge reflection rim on canvas
 */
function drawEdgeRim(
  canvas: HTMLCanvasElement,
  radius: number,
  rimWidth: number,
  brightness: number,
  colorData: {
    topColor: [number, number, number];
    avgColor: [number, number, number];
  }
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  // Create radial gradient for edge rim effect
  // The rim should be brightest at the very edge, fading inward
  ctx.save();

  // Draw rounded rectangle path matching container shape
  const drawRoundedRect = (
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  // Outer edge (bright rim)
  drawRoundedRect(0, 0, width, height, radius);
  ctx.clip();

  // Use the most vibrant sampled color
  const [baseR, baseG, baseB] = colorData.topColor;

  // Brighten the sampled color
  const [brightR, brightG, brightB] = brightenColor(
    baseR,
    baseG,
    baseB,
    brightness
  );

  // Draw rim as a stroked rounded rectangle with gradient
  // Use multiple passes for a softer glow effect
  for (let passIndex = 0; passIndex < 2; passIndex++) {
    const alpha = passIndex === 0 ? 0.6 : 0.3;
    const lineW = rimWidth * (2 - passIndex * 0.5);
    const offset = passIndex * 0.5;

    ctx.strokeStyle = `rgba(${brightR}, ${brightG}, ${brightB}, ${alpha})`;
    ctx.lineWidth = lineW;
    ctx.beginPath();
    drawRoundedRect(
      offset + lineW / 2,
      offset + lineW / 2,
      width - offset * 2 - lineW,
      height - offset * 2 - lineW,
      Math.max(0, radius - offset)
    );
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Hook for handling Canvas 2D edge reflection effect
 */
export function useEdgeReflection(
  options: UseEdgeReflectionOptions = {}
): UseEdgeReflectionReturn {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isReady, setIsReady] = useState(false);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const intervalRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Update canvas size to match container
  const updateCanvasSize = useCallback(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const canvas = canvasRef.current;

    // Set canvas size to match container
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
  }, []);

  // Render edge reflection
  const renderEdgeReflection = useCallback(() => {
    if (!opts.enabled || !containerRef.current || !canvasRef.current) return;

    updateCanvasSize();

    // Sample edge colors
    const edgeData = sampleEdgeColors(
      containerRef.current,
      opts.radius,
      opts.rimWidth
    );

    // Draw edge rim
    drawEdgeRim(
      canvasRef.current,
      opts.radius,
      opts.rimWidth,
      opts.brightness,
      edgeData
    );

    setIsReady(true);
  }, [
    opts.enabled,
    opts.radius,
    opts.rimWidth,
    opts.brightness,
    updateCanvasSize,
  ]);

  // Setup continuous sampling if interval > 0
  useEffect(() => {
    if (!opts.enabled) return;

    const frameId = animationFrameRef.current;

    // Initial render - use requestAnimationFrame to avoid setState in effect
    const initialFrame = requestAnimationFrame(() => {
      renderEdgeReflection();
    });

    // Setup continuous sampling if requested
    if (opts.samplingInterval > 0) {
      intervalRef.current = setInterval(
        renderEdgeReflection,
        opts.samplingInterval
      );
    }

    return () => {
      cancelAnimationFrame(initialFrame);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [opts.enabled, opts.samplingInterval, renderEdgeReflection]);

  // Handle resize
  useEffect(() => {
    if (!opts.enabled) return;

    const handleResize = () => {
      renderEdgeReflection();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [opts.enabled, renderEdgeReflection]);

  return {
    containerRef,
    canvasRef,
    isReady,
  };
}

export default useEdgeReflection;
