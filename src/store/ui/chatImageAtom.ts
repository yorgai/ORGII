/**
 * Chat Image Attachment Atoms
 *
 * Manages pasted/dropped images in the chat input area.
 * Images are stored as optimized base64 data URLs.
 */
import { atom } from "jotai";

// ============================================
// Types
// ============================================

export interface ChatImageAttachment {
  /** Unique ID for this attachment */
  id: string;
  /** Optimized base64 data URL */
  dataUrl: string;
  /** Original file name (if available) */
  fileName: string;
  /** File size in bytes (after optimization) */
  size: number;
  /** Image dimensions */
  width: number;
  height: number;
  ownerId?: string;
}

// ============================================
// Atoms
// ============================================

/** Images attached to the current chat input (max 5) */
export const chatImageAttachmentsAtom = atom<ChatImageAttachment[]>([]);
chatImageAttachmentsAtom.debugLabel = "chatImageAttachmentsAtom";

// ============================================
// Constants
// ============================================

export const MAX_CHAT_IMAGES = 5;
