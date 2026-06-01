import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import type { ContextMenuItem } from "@src/types/core/shared";

export function getShortcutLabel(item: ContextMenuItem): string {
  if (item.shortcutId) return getShortcutKeys(item.shortcutId);
  if (item.keybinding) return item.keybinding.toUpperCase();
  return item.shortcut ?? "";
}

export function getContextMenuShortcut(item: ContextMenuItem): string {
  return item.keybinding ?? item.shortcut ?? "";
}

function normalizeShortcutKeyLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower === "⌫") return "backspace";
  if (lower === "delete") return "delete";
  return lower;
}

export function matchesDisplayedShortcut(
  shortcut: string,
  event: KeyboardEvent
): boolean {
  if (!shortcut) return false;
  const parts = shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const keyPart = parts.at(-1);
  if (!keyPart) return false;
  const normalizedKey = normalizeShortcutKeyLabel(keyPart);
  const keyMatches = event.key.toLowerCase() === normalizedKey;
  if (!keyMatches) return false;

  const requiresCmd = parts.some((part) => part === "⌘" || /^cmd$/i.test(part));
  const requiresCtrl = parts.some(
    (part) => part === "⌃" || /^ctrl$/i.test(part)
  );
  const requiresAlt = parts.some((part) => part === "⌥" || /^alt$/i.test(part));
  const requiresShift = parts.some(
    (part) => part === "⇧" || /^shift$/i.test(part)
  );
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const cmdPressed = isMac ? event.metaKey : event.ctrlKey;

  return (
    (!requiresCmd || cmdPressed) &&
    (!requiresCtrl || event.ctrlKey) &&
    (!requiresAlt || event.altKey) &&
    (!requiresShift || event.shiftKey)
  );
}

export function matchesContextShortcut(
  item: ContextMenuItem,
  event: KeyboardEvent
): boolean {
  if (
    item.shortcutId &&
    matchesDisplayedShortcut(getShortcutKeys(item.shortcutId), event)
  )
    return true;
  const shortcut = getContextMenuShortcut(item);
  if (!shortcut) return false;
  const normalized = shortcut.toLowerCase();
  if (normalized.length !== 1) return false;
  return (
    event.key.toLowerCase() === normalized &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  );
}
