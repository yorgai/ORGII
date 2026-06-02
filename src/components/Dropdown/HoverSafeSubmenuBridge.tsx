import React from "react";

export type HoverSafeSubmenuSide = "left" | "right";

export interface HoverSafeSubmenuBridgeProps {
  side: HoverSafeSubmenuSide;
  primaryLeft: number;
  primaryTop: number;
  primaryWidth: number;
  primaryHeight: number;
  submenuLeft: number;
  submenuTop: number;
  submenuWidth: number;
  submenuHeight: number;
  edgeOverlap?: number;
  verticalPadding?: number;
  zIndex?: number;
}

const DEFAULT_EDGE_OVERLAP = 12;
const DEFAULT_VERTICAL_PADDING = 18;
const DEFAULT_Z_INDEX = 1051;

export const HoverSafeSubmenuBridge: React.FC<HoverSafeSubmenuBridgeProps> = ({
  side,
  primaryLeft,
  primaryTop,
  primaryWidth,
  primaryHeight,
  submenuLeft,
  submenuTop,
  submenuWidth,
  submenuHeight,
  edgeOverlap = DEFAULT_EDGE_OVERLAP,
  verticalPadding = DEFAULT_VERTICAL_PADDING,
  zIndex = DEFAULT_Z_INDEX,
}) => {
  const primaryEdge =
    side === "right" ? primaryLeft + primaryWidth : primaryLeft;
  const submenuEdge =
    side === "right" ? submenuLeft : submenuLeft + submenuWidth;
  const bridgeLeft = Math.min(primaryEdge, submenuEdge) - edgeOverlap;
  const bridgeRight = Math.max(primaryEdge, submenuEdge) + edgeOverlap;
  const bridgeTop = Math.min(primaryTop, submenuTop) - verticalPadding;
  const bridgeBottom =
    Math.max(primaryTop + primaryHeight, submenuTop + submenuHeight) +
    verticalPadding;

  return (
    <div
      aria-hidden="true"
      className="fixed bg-transparent"
      style={{
        left: bridgeLeft,
        top: bridgeTop,
        width: Math.max(0, bridgeRight - bridgeLeft),
        height: Math.max(0, bridgeBottom - bridgeTop),
        zIndex,
      }}
    />
  );
};

export default HoverSafeSubmenuBridge;
