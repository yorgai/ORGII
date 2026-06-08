// UI Hooks - Main Export
export * from "./tabs";
export * from "./sidebar";
export * from "./layout";
export * from "./effects";

// Copy check (icon swap Copy → Check on successful copy)
export { useCopyCheck } from "./useCopyCheck";

// Refresh spin (one-shot spin animation for refresh icons)
export { useRefreshSpin } from "./useRefreshSpin";

// Resize handle for panel resizing (pixel-based)
export { useResizeHandle } from "./useResizeHandle";
export type {
  UseResizeHandleOptions,
  UseResizeHandleReturn,
} from "./useResizeHandle";

// Ratio-based resize for split panes
export { useRatioResize } from "./useRatioResize";
export type {
  UseRatioResizeOptions,
  UseRatioResizeReturn,
} from "./useRatioResize";

// Context menu for resize handles (default width / minimize)
export { useResizeContextMenu } from "./useResizeContextMenu";
export type { UseResizeContextMenuOptions } from "./useResizeContextMenu";

// Draft-mode number input (free typing, validate on blur)
export { useDraftNumber } from "./useDraftNumber";

// Undoable state (Ctrl+Z / Ctrl+Shift+Z)
export {
  useUndoableState,
  useUndoStack,
  useUndoStackWithRestore,
} from "./useUndoableState";

// Auto-timeout countdown (agent question auto-skip / plan auto-execute)
export { useAutoTimeout } from "./useAutoTimeout";
export type {
  UseAutoTimeoutOptions,
  UseAutoTimeoutReturn,
} from "./useAutoTimeout";

// Safe hover (unmount-safe, no stuck hover states)
export { useSafeHover, useSafeHoverCallbacks } from "./useSafeHover";
export type { UseSafeHoverOptions } from "./useSafeHover";

// Collapsible toggle state (open/closed sections)
export { useCollapsible } from "./useCollapsible";
export type {
  UseCollapsibleOptions,
  UseCollapsibleReturn,
} from "./useCollapsible";
