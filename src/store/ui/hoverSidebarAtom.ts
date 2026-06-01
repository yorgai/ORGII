/**
 * Hover Sidebar State Atom
 *
 * Manages the visibility state of the hover sidebar
 * that appears when user hovers over the left edge
 * while the main sidebar is collapsed.
 */
import { atom } from "jotai";

/**
 * Hover sidebar open state
 * - true: Hover sidebar is visible
 * - false: Hover sidebar is hidden
 */
export const hoverSidebarOpenAtom = atom<boolean>(false);
hoverSidebarOpenAtom.debugLabel = "hoverSidebarOpenAtom";
