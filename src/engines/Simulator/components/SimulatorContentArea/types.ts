/**
 * Types for SimulatorContentArea
 */
import type { SessionEvent, SessionSpec } from "@src/engines/SessionCore";

export interface SimulatorContentAreaProps {
  index?: number;
  agentColor?: string;
  currentEvent?: SessionEvent | null;
  events?: SessionEvent[];
  specs?: SessionSpec[];
  onDockAppClick?: (appId: string) => void;
  forceAppType?: import("../../types/appTypes").AppType | null;
  hideHeader?: boolean;
  compactMode?: boolean;
}
