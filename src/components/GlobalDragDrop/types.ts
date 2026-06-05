/**
 * GlobalDragDrop Types
 */

/** Indicator location type */
export type IndicatorLocation = "center" | "chat-panel";

/** Drag-drop mode — derived per-drag from the drop target, not the route */
export type DragDropMode = "chat-file" | "repository";

/** Resolved drag-drop behavior for the current drag operation */
export interface DragDropBehavior {
  mode: DragDropMode;
  location: IndicatorLocation;
}

/** Dropped folder information */
export interface DroppedFolder {
  path: string;
  name: string;
}

/** Dropped file information */
export interface DroppedFileInfo {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  browserFile?: File;
  dropTargetId?: string;
}

/** IDE file drop information */
export interface IdeFileDropInfo {
  path: string;
  name: string;
  extension?: string;
  language?: string;
}
