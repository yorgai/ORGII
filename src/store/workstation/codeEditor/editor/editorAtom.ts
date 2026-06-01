/**
 * Editor Atom
 *
 * State management for the code editor (/orgii/workstation/code)
 * Includes editor UI state and code selection/citation functionality
 */
import { atom } from "jotai";

// ============================================
// Editor UI State
// ============================================

/** Show/hide chat panel in editor */
export const editorChatVisibleAtom = atom<boolean>(false);
editorChatVisibleAtom.debugLabel = "editorChatVisibleAtom";

// ============================================
// Code Selection & Citation
// (Moved from codebaseChatModeAtom - editor-specific functionality)
// ============================================

/** Selected code text for citation */
export const selectedCiteTextAtom = atom<string>("");
selectedCiteTextAtom.debugLabel = "selectedCiteTextAtom";

/** Selected code range (start/end line numbers) */
export const selectedCiteRangeAtom = atom<{
  start: number;
  end: number;
} | null>(null);
selectedCiteRangeAtom.debugLabel = "selectedCiteRangeAtom";

/** Is user currently citing code? */
export const isCiteCodeAtom = atom<boolean>(false);
isCiteCodeAtom.debugLabel = "isCiteCodeAtom";

/** Current selected file name */
export const curSelectFileNameAtom = atom<string>("");
curSelectFileNameAtom.debugLabel = "curSelectFileNameAtom";
