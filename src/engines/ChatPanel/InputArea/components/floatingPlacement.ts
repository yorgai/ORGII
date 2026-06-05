import { DROPDOWN_PANEL } from "@src/components/Dropdown/tokens";

export type FloatingPlacement = "up" | "down";

export interface FloatingAnchorRect {
  top: number;
  bottom: number;
  left: number;
}

export interface FloatingPosition {
  top: number;
  left: number;
  placement: FloatingPlacement;
  availableHeight: number;
}

interface ComputeFloatingPositionOptions {
  anchorRect: FloatingAnchorRect;
  floatingWidth: number;
  floatingHeight: number;
  viewportWidth?: number;
  viewportHeight?: number;
  margin?: number;
  minAvailableHeight?: number;
}

const DEFAULT_VIEWPORT_MARGIN = 8;
const DEFAULT_MIN_AVAILABLE_HEIGHT = 120;

function clampToViewport(
  value: number,
  size: number,
  viewportSize: number,
  margin: number
): number {
  const maxValue = Math.max(margin, viewportSize - size - margin);
  return Math.min(Math.max(margin, value), maxValue);
}

export function computePreferUpFloatingPosition({
  anchorRect,
  floatingWidth,
  floatingHeight,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
  margin = DEFAULT_VIEWPORT_MARGIN,
  minAvailableHeight = DEFAULT_MIN_AVAILABLE_HEIGHT,
}: ComputeFloatingPositionOptions): FloatingPosition {
  const gap = DROPDOWN_PANEL.triggerGap;
  const spaceAbove = anchorRect.top - gap - margin;
  const spaceBelow = viewportHeight - anchorRect.bottom - gap - margin;
  const placement: FloatingPlacement =
    floatingHeight > spaceAbove && spaceBelow > spaceAbove ? "down" : "up";
  const availableHeight = placement === "down" ? spaceBelow : spaceAbove;
  const effectiveHeight = Math.min(
    floatingHeight,
    Math.max(minAvailableHeight, Math.floor(availableHeight))
  );
  const unclampedTop =
    placement === "down"
      ? anchorRect.bottom + gap
      : anchorRect.top - effectiveHeight - gap;

  return {
    top: clampToViewport(unclampedTop, effectiveHeight, viewportHeight, margin),
    left: clampToViewport(
      anchorRect.left,
      floatingWidth,
      viewportWidth,
      margin
    ),
    placement,
    availableHeight: Math.max(minAvailableHeight, Math.floor(availableHeight)),
  };
}
