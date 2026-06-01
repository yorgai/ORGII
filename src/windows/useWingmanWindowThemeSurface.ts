import { useLayoutEffect } from "react";

const WINGMAN_SURFACE_BACKGROUND = "var(--color-bg-1, #ffffff)";
const WINGMAN_TRANSPARENT_BACKGROUND = "transparent";

export function useWingmanWindowThemeSurface(transparent = false): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const appRoot = document.getElementById("root");
    const background = transparent
      ? WINGMAN_TRANSPARENT_BACKGROUND
      : WINGMAN_SURFACE_BACKGROUND;

    root.style.background = background;
    body.style.background = background;
    appRoot?.style.setProperty("background", background);

    return () => {
      root.style.removeProperty("background");
      body.style.removeProperty("background");
      appRoot?.style.removeProperty("background");
    };
  }, [transparent]);
}
