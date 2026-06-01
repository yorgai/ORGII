/**
 * Keyboard Hooks
 *
 * Centralized keyboard utilities for navigation, shortcuts, and input handling.
 */

// ============================================
// Hooks
// ============================================

export {
  useListNavigation,
  type ListItem,
  type UseListNavigationOptions,
  type UseListNavigationReturn,
} from "./useListNavigation";

export { useKeyboardSave } from "./useKeyboardSave";

export {
  useTauriSelectAllShortcut,
  installGlobalTauriSelectAllShortcut,
} from "./useTauriSelectAllShortcut";

export {
  useKeyboardMouseMode,
  type UseKeyboardMouseModeOptions,
  type UseKeyboardMouseModeReturn,
} from "./useKeyboardMouseMode";

// ============================================
// Shortcut Registry (runtime event matching)
// ============================================

export {
  shortcutRegistry,
  SHORTCUT_DEFINITIONS,
  type ShortcutDefinition,
  type ShortcutCategory,
  type ShortcutScope,
  type Modifier,
} from "@src/config/keyboard/ShortcutRegistry";

// ============================================
// Shortcut Display (centralized lookup)
// ============================================

export {
  getShortcutKeys,
  getShortcutEntry,
  labelWithShortcut,
  isModifierPressed,
  matchesKey,
} from "@src/config/keyboard/shortcutDisplay";
