/**
 * PreviewBottomBar
 *
 * Shared chrome for all file-preview bottom bars (image, video, …).
 * Provides the fixed-height container with a top border and consistent
 * padding. Callers fill `left` and `right` slot props with their own
 * metadata / controls.
 *
 * Also exports `formatFileSize` so all preview bottom bars display
 * sizes consistently (B → KB → MB → GB).
 *
 * Used by: ImageBottomBar, VideoPreview
 */
import React from "react";

// ============================================
// Shared utility
// ============================================

/**
 * Format a byte count for display in a preview bottom bar.
 * Scales through B → KB → MB → GB.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(exp > 0 ? 1 : 0)} ${units[exp]}`;
}

// ============================================
// Component
// ============================================

export interface PreviewBottomBarProps {
  /** Left slot — metadata labels (dimensions, duration, size, format…) */
  left?: React.ReactNode;
  /** Right slot — action controls (zoom buttons, toggles…) */
  right?: React.ReactNode;
}

export const PreviewBottomBar: React.FC<PreviewBottomBarProps> = ({
  left,
  right,
}) => (
  <div className="flex h-10 shrink-0 items-center justify-between px-3">
    <div className="flex items-center gap-3 text-[11px] text-text-3">
      {left}
    </div>
    {right && <div className="flex items-center gap-1">{right}</div>}
  </div>
);

export default PreviewBottomBar;
