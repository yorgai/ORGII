/**
 * useStrokeDraw - Repeating stroke-draw animation for SVG icons
 *
 * Plays a draw-on animation for all SVG geometry elements within a wrapper.
 * Used for loading indicators on event icons in the chat panel.
 *
 * Usage:
 *   const ref = useStrokeDraw(isLoading);
 *   <div ref={ref}><Terminal size={14} /></div>
 *
 * Implementation note: the animation requires a live wrapper element
 * to query the SVG out of. Because many call sites mount the wrapper
 * conditionally (e.g. `{isLoading && <div ref={ref} />}`), we go
 * through `useCallbackRefEffect` instead of the `useRef + useEffect`
 * pattern — the latter silently no-ops when the ref'd element only
 * appears AFTER the first render, because the effect bailed early
 * with `ref.current === null` and never re-runs.
 */
import type { MutableRefObject } from "react";

import {
  type CallbackRefEffectHandle,
  useCallbackRefEffect,
} from "@src/hooks/dom/useCallbackRefEffect";

const STROKE_DRAW_INTERVAL_MS = 2200;

export function runStrokeDraw(wrapper: HTMLElement) {
  const svg = wrapper.querySelector("svg");
  if (!svg) return;

  const shapes = svg.querySelectorAll(
    "path, line, circle, rect, polyline, polygon, ellipse"
  );

  shapes.forEach((el, index) => {
    if (!(el instanceof SVGGeometryElement)) return;
    let totalLength: number;
    try {
      totalLength = el.getTotalLength();
    } catch {
      return;
    }
    if (totalLength === 0) return;

    const shape = el as SVGGeometryElement;
    shape.style.transition = "none";
    shape.setAttribute("stroke-dasharray", String(totalLength));
    shape.setAttribute("stroke-dashoffset", String(totalLength));
    shape.style.opacity = "0.3";

    const delay = index * 60;
    setTimeout(() => {
      shape.style.transition =
        "stroke-dashoffset 400ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease";
      shape.setAttribute("stroke-dashoffset", "0");
      shape.style.opacity = "1";
    }, delay);

    setTimeout(() => {
      shape.style.transition = "";
      shape.removeAttribute("stroke-dasharray");
      shape.removeAttribute("stroke-dashoffset");
      shape.style.opacity = "";
    }, delay + 450);
  });
}

/**
 * Hook that applies a repeating stroke-draw animation to an SVG icon.
 *
 * Returns a stable ref-callback to attach to the wrapper element
 * (`ref={refCb}`). When `externalRef` is provided, the hook ALSO
 * mirrors the attached element into it on attach and clears it on
 * detach — useful for composition with other ref-based hooks.
 *
 * Late-mount safe: if the wrapper element mounts AFTER first render
 * (e.g. it lives inside a conditional branch), the animation kicks
 * in at the attach point, not at first render. This is the whole
 * reason the hook routes through `useCallbackRefEffect` rather than
 * `useEffect(_, [ref])`.
 */
export function useStrokeDraw(
  enabled: boolean,
  externalRef?: MutableRefObject<HTMLDivElement | null>
): CallbackRefEffectHandle<HTMLDivElement> {
  return useCallbackRefEffect<HTMLDivElement>(
    (wrapper) => {
      // Mirror the attached element into the caller's ref so other
      // composed hooks can see it. We do this before kicking off
      // the animation so any synchronous observer (none today, but
      // defensive) sees a consistent `externalRef.current`.
      if (externalRef) externalRef.current = wrapper;
      if (!enabled) {
        return () => {
          if (externalRef) externalRef.current = null;
        };
      }
      runStrokeDraw(wrapper);
      const intervalId = setInterval(
        () => runStrokeDraw(wrapper),
        STROKE_DRAW_INTERVAL_MS
      );
      return () => {
        clearInterval(intervalId);
        if (externalRef) externalRef.current = null;
      };
    },
    [enabled, externalRef]
  );
}
