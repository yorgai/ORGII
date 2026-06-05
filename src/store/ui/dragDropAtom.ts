/**
 * Drag & Drop Atoms
 *
 * Manages global drag-drop state for file uploads
 */
import { atom } from "jotai";

// ============================================
// Types
// ============================================

export interface DroppedFile {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  browserFile?: File;
  dropTargetId?: string;
}

// ============================================
// Atoms
// ============================================

/**
 * Dropped files pending to be added to upload area
 * Used when dropping files on create-session or session workspace pages
 */
export const droppedFilesAtom = atom<DroppedFile[]>([]);

/**
 * Clear dropped files after they've been processed
 */
export const clearDroppedFilesAtom = atom(null, (_get, set) => {
  set(droppedFilesAtom, []);
});
