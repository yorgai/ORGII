/**
 * SimulatorContentArea Component
 *
 * Main content area for the simulator with header, wallpaper background.
 * Pairs with SimulatorTitleBar to create the complete simulator window experience.
 * Renders simulator content for the active app.
 *
 * Refactored structure:
 * - Main component: orchestration and prop management
 * - SimulatorSingleView: single view rendering
 * - useSimulatorContent: content rendering and caching
 * - StateDisplays: idle and booting state components
 */
import { useAtomValue } from "jotai";
import { type FC, memo } from "react";

import { useBackgroundImage } from "@src/hooks/theme/useBackgroundImage";
import useProgressiveImage from "@src/hooks/ui/effects/useProgressiveImage";
import { globalLayoutMethodAtom } from "@src/store/ui/uiAtom";

import { SimulatorSingleView } from "./components/SimulatorContentArea/SimulatorSingleView";
import { BootingState } from "./components/SimulatorContentArea/StateDisplays";
import type { SimulatorContentAreaProps } from "./components/SimulatorContentArea/types";
import { useSimulatorContent } from "./components/SimulatorContentArea/useSimulatorContent";

const SimulatorContentAreaComponent: FC<SimulatorContentAreaProps> = ({
  currentEvent = null,
  events = [],
  specs = [],
  onDockAppClick: _onDockAppClick,
  forceAppType = null,
  hideHeader = false,
  compactMode = false,
}) => {
  const wallpaperBg = useBackgroundImage();

  useProgressiveImage({
    src: wallpaperBg,
    autoLoad: true,
  });

  const { mainContentAppType, isBootingEvent, displayContent } =
    useSimulatorContent({
      currentEvent,
      events,
      specs,
      forceAppType,
    });

  const globalLayoutMethod = useAtomValue(globalLayoutMethodAtom);
  const isFullMode = globalLayoutMethod === "full";

  return (
    <div
      className={`group relative flex h-full w-full flex-col overflow-hidden ${!hideHeader && !isFullMode ? "rounded-xl" : ""} transition-all duration-300`}
    >
      {!isBootingEvent && (
        <SimulatorSingleView
          isBootingEvent={isBootingEvent}
          mainContentAppType={mainContentAppType}
          displayContent={displayContent}
          hideHeader={hideHeader}
          compactMode={compactMode}
        />
      )}

      {isBootingEvent && (
        <div
          className={`relative flex h-full w-full flex-col overflow-hidden ${!hideHeader && !isFullMode ? "rounded-xl" : ""} bg-bg-2`}
        >
          <div className="min-h-0 flex-1 overflow-auto text-text-1">
            <BootingState />
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Custom comparison function to prevent unnecessary re-renders.
 * Only re-renders when:
 * - Event ID changes (not just object reference)
 * - Visual props change (agentColor)
 * - Index changes
 */
const arePropsEqual = (
  prev: SimulatorContentAreaProps,
  next: SimulatorContentAreaProps
): boolean => {
  const prevEventId = prev.currentEvent?.id;
  const nextEventId = next.currentEvent?.id;

  if (prevEventId || nextEventId) {
    if (prevEventId !== nextEventId) return false;
  } else {
    if (prev.currentEvent !== next.currentEvent) return false;
    if (prev.currentEvent?.createdAt !== next.currentEvent?.createdAt)
      return false;
  }

  if (prev.currentEvent?.functionName !== next.currentEvent?.functionName)
    return false;

  if (prev.index !== next.index) return false;
  if (prev.agentColor !== next.agentColor) return false;
  if (prev.forceAppType !== next.forceAppType) return false;

  return true;
};

const SimulatorContentArea = memo(SimulatorContentAreaComponent, arePropsEqual);
SimulatorContentArea.displayName = "SimulatorContentArea";

export default SimulatorContentArea;
