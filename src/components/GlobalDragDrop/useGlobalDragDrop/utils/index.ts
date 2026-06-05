/**
 * Utils barrel export for useGlobalDragDrop
 */
export { hasVisibleChatDropTarget, isRepositoryDropPage } from "./routeUtils";
export {
  isInternalDrag,
  isDropInsideChatDropTarget,
  getChatDropTargetId,
  createPreventDefaults,
  type GlobalDragWindow,
} from "./dragDetection";
export {
  extractFilePath,
  extractFilePathAsync,
  type ExtractedFilePath,
} from "./filePathExtraction";
