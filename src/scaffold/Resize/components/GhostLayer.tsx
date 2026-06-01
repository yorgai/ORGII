/**
 * GhostLayer Component
 *
 * Visual overlay that shows the preview size during resize operations.
 * This is the ONLY element that changes during resize - the actual content stays static.
 *
 * Key principles:
 * - Absolutely positioned overlay
 * - Only visible during resize
 * - Uses will-change for GPU acceleration
 * - Pointer events disabled (doesn't interfere with content)
 */
import { forwardRef, memo } from "react";

import type { GhostLayerProps } from "../types";

// ============================================
// Component
// ============================================

export const GhostLayer = memo(
  forwardRef<HTMLDivElement, GhostLayerProps>(
    ({ axis, className = "" }, ref) => {
      return (
        <div
          ref={ref}
          className={`ghost-layer pointer-events-none absolute inset-0 z-10 hidden ${className}`}
          style={{
            willChange: axis === "x" ? "width" : "height",
            background:
              "color-mix(in srgb, var(--color-primary-6) 8%, transparent)",
            borderRight:
              axis === "x" ? "2px solid var(--color-primary-6)" : undefined,
            borderBottom:
              axis === "y" ? "2px solid var(--color-primary-6)" : undefined,
          }}
          aria-hidden="true"
        />
      );
    }
  )
);

GhostLayer.displayName = "GhostLayer";

export default GhostLayer;
