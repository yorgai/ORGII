import { atom } from "jotai";

/**
 * Global sidebar position atom
 * Controls sidebar position (left or right) across all pages
 */
export const globalSidebarPositionAtom = atom<"left" | "right">("left");
globalSidebarPositionAtom.debugLabel = "globalSidebarPositionAtom";
