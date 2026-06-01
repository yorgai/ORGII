import React from "react";

import LiquidGlassToolbar from "@src/components/LiquidGlassToolbar";
import type { LiquidGlassToolbarProps } from "@src/components/LiquidGlassToolbar";

type ToolbarGlassChrome =
  | "segmentedSwitch"
  | "segmentedTabs"
  | "buttonGroup"
  | "roundButton"
  | "pillButton"
  | "statusPill";

const TOOLBAR_GLASS_DEFAULT_HEIGHT = 36;
const TOOLBAR_GLASS_DEFAULT_RADIUS = 100;

const TOOLBAR_GLASS_CHROME_PROPS: Record<
  ToolbarGlassChrome,
  Pick<LiquidGlassToolbarProps, "padding" | "gap" | "square">
> = {
  segmentedSwitch: { padding: "4px", gap: 1 },
  segmentedTabs: { padding: "4px", gap: 4 },
  buttonGroup: { padding: "0 4px", gap: 4 },
  roundButton: { padding: "0", gap: 0, square: true },
  pillButton: { padding: "0", gap: 0 },
  statusPill: { padding: "0 16px", gap: 8 },
};

export interface ToolbarGlassContainerProps extends Omit<
  LiquidGlassToolbarProps,
  "height" | "radius" | "intensity"
> {
  chrome: ToolbarGlassChrome;
  height?: LiquidGlassToolbarProps["height"];
  radius?: LiquidGlassToolbarProps["radius"];
  intensity?: LiquidGlassToolbarProps["intensity"];
}

export const ToolbarGlassContainer: React.FC<ToolbarGlassContainerProps> = ({
  chrome,
  height = TOOLBAR_GLASS_DEFAULT_HEIGHT,
  radius = TOOLBAR_GLASS_DEFAULT_RADIUS,
  intensity = "default",
  padding,
  gap,
  square,
  children,
  ...props
}) => {
  const chromeProps = TOOLBAR_GLASS_CHROME_PROPS[chrome];

  return (
    <LiquidGlassToolbar
      height={height}
      radius={radius}
      intensity={intensity}
      padding={padding ?? chromeProps.padding}
      gap={gap ?? chromeProps.gap}
      square={square ?? chromeProps.square}
      {...props}
    >
      {children}
    </LiquidGlassToolbar>
  );
};

export default ToolbarGlassContainer;
