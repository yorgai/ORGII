// ============================================
// Icon Configuration
// ============================================

export const ICON_CONFIG = {
  add: "Plus",
  addContent: "AtSign",
  upload: "Paperclip",
} as const;

// ============================================
// Menu Configuration
// ============================================

export const ACTION_ITEMS = [
  { id: "add-content", label: "@ Add Content" },
  { id: "upload", label: "Upload" },
] as const;

export type AddActionsItemId = (typeof ACTION_ITEMS)[number]["id"];
