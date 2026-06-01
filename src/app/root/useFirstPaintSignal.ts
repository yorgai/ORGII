/**
 * useFirstPaintSignal
 *
 * Fires `signalFirstPaintComplete` after the browser has had two animation
 * frames to commit the initial render, then removes the HTML splash screen.
 *
 * Two nested `requestAnimationFrame` calls are intentional:
 * - Frame 1: React has committed the DOM (paint scheduled)
 * - Frame 2: The browser has actually painted pixels to screen
 *
 * `useLayoutEffect` is used (rather than `useEffect`) so the rAF is scheduled
 * synchronously after DOM mutation, before the browser has a chance to run
 * its own paint pass — guaranteeing the splash is removed in the same frame
 * as the first real content.
 *
 * `hasSignaledFirstPaint` ref prevents double-firing on React StrictMode's
 * double-invocation of effects in development.
 */
import { useLayoutEffect, useRef } from "react";

import { signalFirstPaintComplete } from "@src/util/core/init/deferredInit";

export function useFirstPaintSignal(): void {
  const hasSignaledFirstPaint = useRef(false);

  useLayoutEffect(() => {
    if (hasSignaledFirstPaint.current) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (hasSignaledFirstPaint.current) {
          return;
        }

        hasSignaledFirstPaint.current = true;
        signalFirstPaintComplete();

        const splash = document.getElementById("splash");
        if (splash) {
          splash.classList.add("fade-out");
          setTimeout(() => splash.remove(), 200);
        }
      });
    });
  }, []);
}
