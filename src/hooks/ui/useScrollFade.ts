/**
 * useScrollFade Hook
 *
 * Returns scroll-fade classes that are scroll-position-aware:
 * - No fade when content fits without scrolling
 * - No top fade when scrolled to top; no bottom fade when scrolled to bottom
 * - Both fades when scrolled to the middle
 */
import { type RefObject, useEffect, useState } from "react";

import { SCROLL_FADE_TOKENS } from "@src/modules/shared/layouts/tokens/scrollFadeTokens";

const SCROLL_THRESHOLD = 2;

type FadePosition = "none" | "at-top" | "at-bottom" | "middle";

function computeFadePosition(element: HTMLElement): FadePosition {
  if (element.scrollHeight <= element.clientHeight) return "none";

  const atTop = element.scrollTop <= SCROLL_THRESHOLD;
  const atBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    SCROLL_THRESHOLD;

  if (atTop && atBottom) return "none";
  if (atTop) return "at-top";
  if (atBottom) return "at-bottom";
  return "middle";
}

function buildClassName(position: FadePosition): string {
  if (position === "none") return "";
  const base = SCROLL_FADE_TOKENS.container;
  if (position === "at-top") return `${base} ${SCROLL_FADE_TOKENS.atTop}`;
  if (position === "at-bottom") return `${base} ${SCROLL_FADE_TOKENS.atBottom}`;
  return base;
}

export function useScrollFade(ref: RefObject<HTMLElement | null>): string {
  const [position, setPosition] = useState<FadePosition>("none");

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const check = () => setPosition(computeFadePosition(element));
    check();

    element.addEventListener("scroll", check, { passive: true });

    const resizeObserver = new ResizeObserver(check);
    resizeObserver.observe(element);

    const mutationObserver = new MutationObserver(check);
    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
    });

    return () => {
      element.removeEventListener("scroll", check);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [ref]);

  return buildClassName(position);
}
