import { createContext } from "react";

/**
 * Slot subscription for the shell's footer action host.
 *
 * The shell implements a tiny store with `subscribe` and `getSnapshot`
 * methods (the useSyncExternalStore shape). Palette-level
 * `ShellFooterAction` components subscribe to read the current host
 * element and react to mount/unmount with zero effect ping-pong.
 *
 * `null` context means there is no enclosing SpotlightShell (e.g.
 * pure-input palettes) — actions silently render nothing.
 */
export interface FooterActionSlot {
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => HTMLDivElement | null;
}

export const SpotlightFooterActionContext =
  createContext<FooterActionSlot | null>(null);
