/**
 * TextSelectionDropdown Configuration
 *
 * Configuration for the text selection dropdown that appears
 * when text is selected in terminal, browser, or editor views.
 */
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileCode,
  type LucideIcon,
  MessageCircleQuestion,
  MessageSquare,
  Plus,
  TextQuote,
} from "lucide-react";

// ============================================
// Types
// ============================================

export type DropdownAction =
  | "ask-agent"
  | "add-to-chat"
  | "add-to-context"
  | "add-file"
  | "add-lines";

export interface DropdownMenuItem {
  id: DropdownAction;
  label: string;
  icon: LucideIcon;
  hasSecondLayer?: boolean;
  description?: string;
}

export interface SessionItem {
  sessionId: string;
  name: string;
  isNew?: boolean;
  updatedAt?: string;
}

// ============================================
// Icon Configuration
// ============================================

export const ICON_CONFIG = {
  askAgent: MessageCircleQuestion,
  addContext: Plus,
  addFile: FileCode,
  addLines: TextQuote,
  session: MessageSquare,
  newSession: Plus,
  arrow: ArrowRight,
  arrowBack: ArrowLeft,
  check: Check,
} as const;

// ============================================
// Menu Configuration
// ============================================

// Menu items for terminal/browser — single action, no session picker
export const MENU_ITEMS: DropdownMenuItem[] = [
  {
    id: "add-to-chat",
    label: "Add to Chat",
    icon: ICON_CONFIG.addContext,
    hasSecondLayer: false,
    description: "Insert selected text into the chat composer",
  },
];

// Menu items for editor
export const EDITOR_MENU_ITEMS: DropdownMenuItem[] = [
  {
    id: "add-file",
    label: "Add this file to agent",
    icon: ICON_CONFIG.addFile,
    hasSecondLayer: false,
    description: "Add entire file to agent",
  },
  {
    id: "add-lines",
    label: "Add line {from} ~ {to} to agent",
    icon: ICON_CONFIG.addLines,
    hasSecondLayer: false,
    description: "Add selected lines to agent",
  },
];

// ============================================
// Style Configuration
// ============================================

export const STYLE_CONFIG = {
  dropdownWidth: "220px",
  secondLayerWidth: "240px",
  maxHeight: "240px",
  itemHeight: "36px",
  zIndex: 99999,
} as const;

// ============================================
// Keyboard Shortcuts
// ============================================

export const KEYBOARD_CONFIG = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  enter: "Enter",
  escape: "Escape",
} as const;
