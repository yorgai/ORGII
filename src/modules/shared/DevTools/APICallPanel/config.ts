// ============================================
// Icon Configuration
// ============================================
import {
  Eye,
  Keyboard,
  MousePointerClick,
  Network,
  Search,
  Target,
  Trash2,
  X,
  Zap,
} from "lucide-react";

export const ICON_CONFIG = {
  // Action icons
  close: X,
  delete: Trash2,

  // Panel icons
  api: Network,

  // Trigger icons
  triggerClick: MousePointerClick,
  triggerHover: Eye,
  triggerKeyboard: Keyboard,
  triggerFocus: Target,
  triggerAuto: Zap,
} as const;

// ============================================
// Empty State Icon
// ============================================

export const EMPTY_STATE_ICONS = {
  all: Search,
} as const;
