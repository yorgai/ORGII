/**
 * Global TypeScript declarations for the application
 */

// Webpack Hot Module Replacement
interface HotModule {
  accept(callback?: () => void): void;
  addStatusHandler?(callback: (status: string) => void): void;
}

declare const module: {
  hot?: HotModule;
};

// Internal drag-and-drop state flags
interface Window {
  /** Set when an internal file-tree row drag is in progress */
  __internalFileTreeDrag?: boolean;
  /** JSON-serialised { path, name, type } payload for the active file-tree drag */
  __internalFileTreeDragData?: string;
  /** Set when a WorkStation tab is being dragged (dnd-kit pointer drag) */
  __internalWorkstationTabDrag?: boolean;
  /** JSON-serialised { path, name, type } payload for the active tab drag */
  __internalWorkstationTabDragData?: string;
}
