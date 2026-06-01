/**
 * File Clipboard Atom
 *
 * Manages clipboard state for file copy/paste operations.
 */
import { atom } from "jotai";

// ============================================
// Types
// ============================================

export interface FileClipboard {
  /** File or folder paths in clipboard */
  paths: string[];
  /** Operation type (for future cut support) */
  operation: "copy" | "cut";
}

// ============================================
// Clipboard Atom
// ============================================

/** File clipboard state for copy/paste operations */
export const fileClipboardAtom = atom<FileClipboard | null>(null);
fileClipboardAtom.debugLabel = "fileClipboardAtom";
