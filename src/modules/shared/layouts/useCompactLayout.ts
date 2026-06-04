/**
 * Compact-layout hooks
 *
 * Two predicates land here so every chrome consumer agrees on what
 * "compact" means and the wallpaper-route exception list lives in one
 * place (see `viewContainerTokens.WALLPAPER_ROUTE_PREFIXES`).
 *
 * - `useIsCompactLayout` — true iff the user has picked the compact
 *   global layout. Used by surfaces that don't care about wallpaper
 *   bleed-through (sidebar shadow, MainAppShell padding, Simulator
 *   chrome) — they sit on the side or fill the viewport so the
 *   wallpaper-route exception doesn't apply.
 *
 * - `useIsCompactChromeSurface` — true iff the layout is compact AND
 *   we're not on a route that owns its own wallpaper hero (start
 *   page, repo picker, login, walkthrough). Used by shared chrome that sits
 *   on top of the wallpaper region and needs to step out of the way on those
 *   routes.
 */
import { useAtomValue } from "jotai";
import { useLocation } from "react-router-dom";

import { globalLayoutMethodAtom } from "@src/store/ui/uiAtom";

import { isWallpaperRoutePath } from "./viewContainerTokens";

export function useIsCompactLayout(): boolean {
  const globalLayoutMethod = useAtomValue(globalLayoutMethodAtom);
  return globalLayoutMethod === "compact";
}

export function useIsCompactChromeSurface(): boolean {
  const globalLayoutMethod = useAtomValue(globalLayoutMethodAtom);
  const { pathname } = useLocation();
  return globalLayoutMethod === "compact" && !isWallpaperRoutePath(pathname);
}
