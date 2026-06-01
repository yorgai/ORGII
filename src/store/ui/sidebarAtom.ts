/**
 * Sidebar State Atom
 *
 * Manages sidebar width and shared collapse state (localStorage).
 * Both layout types (home, session) collapse and expand together.
 */
import { atom } from "jotai";

// ============================================
// Constants
// ============================================

export const DEFAULT_SIDEBAR_WIDTH = 240;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 320;
export const COLLAPSED_SIDEBAR_WIDTH = 0;

// ============================================
// Shared collapsed persistence (localStorage)
// ============================================

const SIDEBAR_COLLAPSED_KEY = "orgii_sidebar_collapsed";

const getStoredCollapsed = (): boolean => {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
};

const persistSidebarCollapsed = (collapsed: boolean): void => {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Ignore storage errors
  }
};

// ============================================
// Atoms
// ============================================

/** Global sidebar width (pixels) */
export const sidebarWidthAtom = atom<number>(DEFAULT_SIDEBAR_WIDTH);
sidebarWidthAtom.debugLabel = "sidebarWidthAtom";

const sidebarCollapsedBaseAtom = atom<boolean>(getStoredCollapsed());
sidebarCollapsedBaseAtom.debugLabel = "sidebarCollapsedBaseAtom";

/** Shared main sidebar collapsed state for Home and Agent/session surfaces. */
export const sidebarCollapsedAtom = atom(
  (get) => get(sidebarCollapsedBaseAtom),
  (_get, set, value: boolean) => {
    set(sidebarCollapsedBaseAtom, value);
    persistSidebarCollapsed(value);
  }
);
sidebarCollapsedAtom.debugLabel = "sidebarCollapsedAtom";

/**
 * Sidebar dragging state atom
 */
export const sidebarDraggingAtom = atom<boolean>(false);
sidebarDraggingAtom.debugLabel = "sidebarDraggingAtom";
