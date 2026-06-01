/**
 * Types for useGlobalDragDrop hook module
 */
import type { CSSProperties } from "react";

import type {
  DragDropBehavior,
  DroppedFolder,
  IndicatorLocation,
} from "../types";

/**
 * Return type for the main useGlobalDragDrop hook
 */
export interface UseGlobalDragDropReturn {
  // State
  isDragging: boolean;
  behavior: DragDropBehavior | null;
  droppedFolder: DroppedFolder | null;

  // Actions
  handleOpenSpotlight: () => void;
  setDroppedFolder: (folder: DroppedFolder | null) => void;

  // Layout
  getContainerStyle: (location: IndicatorLocation) => CSSProperties;
}
