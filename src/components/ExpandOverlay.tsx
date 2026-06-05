/**
 * ExpandOverlay
 *
 * Reusable gradient-fade + hover-visible pill for expand/collapse.
 *
 * **Collapsed**: absolute gradient overlay at the bottom of the content
 * area, with a centered pill that appears on hover (parent needs Tailwind
 * `group`).
 *
 * **Expanded**: a `position: sticky` bar at the bottom with a short
 * bottom-to-top fade above the pill (no fixed min-height — avoids a dead
 * gap under long content).
 *
 * Requirements on the parent element:
 *   - `position: relative` (for collapsed absolute overlay)
 *   - Tailwind `group/expand` class (scoped hover detection — avoids
 *     leaking through unrelated `group` ancestors)
 *   - For expanded sticky to work, the parent must be the scroll
 *     container (e.g. `maxHeight: 60vh; overflowY: auto`).
 */
import React from "react";

import FloatingExpandPill from "./FloatingExpandPill";

interface ExpandOverlayProps {
  isExpanded: boolean;
  onToggle: (e: React.MouseEvent) => void;
  collapsedLabel?: string;
  expandedLabel?: string;
  collapsedFadeHeightClass?: string;
  /** Tailwind `from-*` class for the gradient background (default: "from-fill-2") */
  fadeFrom?: string;
}

const ExpandOverlay: React.FC<ExpandOverlayProps> = ({
  isExpanded,
  onToggle,
  collapsedLabel,
  expandedLabel,
  collapsedFadeHeightClass = "h-14",
  fadeFrom = "from-fill-2",
}) => {
  if (!isExpanded) {
    return (
      <>
        <div
          className={`pointer-events-none absolute bottom-0 left-0 right-0 ${collapsedFadeHeightClass} bg-gradient-to-t ${fadeFrom} to-transparent`}
        />
        <div className="absolute bottom-0 left-0 right-0 z-10 flex justify-center pb-1 opacity-0 transition-opacity group-hover/expand:opacity-100">
          <FloatingExpandPill
            expanded={false}
            onClick={onToggle}
            label={collapsedLabel}
          />
        </div>
      </>
    );
  }

  return (
    <div
      className={`sticky -bottom-2 z-10 flex flex-col items-center bg-gradient-to-t ${fadeFrom} to-transparent pb-3 pt-3 opacity-75`}
    >
      <FloatingExpandPill expanded onClick={onToggle} label={expandedLabel} />
    </div>
  );
};

export default React.memo(ExpandOverlay);
