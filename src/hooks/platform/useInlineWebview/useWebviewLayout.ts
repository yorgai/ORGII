import { invoke } from "@tauri-apps/api/core";
import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";

import {
  DEBOUNCE_DELAYS,
  useDebouncedCallback,
} from "@src/hooks/perf/useDebouncedCallback";

export interface UseWebviewLayoutParams {
  containerRef: RefObject<HTMLDivElement | null>;
  isWebviewCreated: boolean;
  isWebviewAvailable: boolean;
  labelRef: MutableRefObject<string>;
  log: (...args: unknown[]) => void;
}

export interface UseWebviewLayoutReturn {
  getContainerRect: () => DOMRect | null;
  updatePosition: (options?: { force?: boolean }) => Promise<void>;
}

function getUiScale(): number {
  const scaleValue = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue("--ui-scale");
  const parsedScale = Number.parseFloat(scaleValue);
  return Number.isFinite(parsedScale) && parsedScale > 0 ? parsedScale : 1;
}

export function useWebviewLayout(
  params: UseWebviewLayoutParams
): UseWebviewLayoutReturn {
  const { containerRef, isWebviewCreated, isWebviewAvailable, labelRef, log } =
    params;

  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const scrollListenerRef = useRef<(() => void) | null>(null);
  const lastResizeRect = useRef<{
    width: number;
    height: number;
    left: number;
    top: number;
  } | null>(null);

  const getContainerRect = useCallback(() => {
    if (!containerRef.current) return null;
    return containerRef.current.getBoundingClientRect();
  }, [containerRef]);

  const updatePosition = useCallback(
    async (options?: { force?: boolean }) => {
      if (!isWebviewCreated || !containerRef.current) return;

      const rect = getContainerRect();
      if (!rect) return;

      const scaleValue = getUiScale();
      // WebKit reports child-anchor rects in CSS-zoomed coordinates, but Wry
      // positions native child webviews in the window's unzoomed coordinate
      // space. Re-expand the frame before crossing the Tauri boundary.
      const nativeFrame = {
        width: rect.width * scaleValue,
        height: rect.height * scaleValue,
        left: rect.left * scaleValue,
        top: rect.top * scaleValue,
      };

      const lastRect = lastResizeRect.current;
      if (
        !options?.force &&
        lastRect &&
        Math.abs(lastRect.width - nativeFrame.width) < 2 &&
        Math.abs(lastRect.height - nativeFrame.height) < 2 &&
        Math.abs(lastRect.left - nativeFrame.left) < 2 &&
        Math.abs(lastRect.top - nativeFrame.top) < 2
      ) {
        return;
      }
      lastResizeRect.current = nativeFrame;

      try {
        await invoke("update_inline_webview_position", {
          label: labelRef.current,
          x: Math.round(nativeFrame.left),
          y: Math.round(nativeFrame.top),
          width: Math.round(nativeFrame.width),
          height: Math.round(nativeFrame.height),
        });
        log("Position updated:", { rect, nativeFrame, scaleValue });
      } catch (err) {
        log("Failed to update position:", err);
      }
    },
    [isWebviewCreated, containerRef, getContainerRect, labelRef, log]
  );

  const debouncedUpdatePosition = useDebouncedCallback(() => {
    void updatePosition();
  }, DEBOUNCE_DELAYS.FRAME);

  useEffect(() => {
    if (!containerRef.current || !isWebviewAvailable) return;

    resizeObserverRef.current = new ResizeObserver(() => {
      debouncedUpdatePosition();
    });

    resizeObserverRef.current.observe(containerRef.current);

    return () => {
      resizeObserverRef.current?.disconnect();
      debouncedUpdatePosition.cancel();
    };
  }, [containerRef, isWebviewAvailable, debouncedUpdatePosition]);

  useEffect(() => {
    if (!isWebviewCreated || !isWebviewAvailable) return;

    const scaleUpdateTimers = new Set<number>();

    const handleScroll = () => {
      debouncedUpdatePosition();
    };

    const scheduleForcedPositionUpdate = (delay: number) => {
      const timer = window.setTimeout(() => {
        scaleUpdateTimers.delete(timer);
        void updatePosition({ force: true });
      }, delay);
      scaleUpdateTimers.add(timer);
    };

    const handleUiScaleApplied = () => {
      void updatePosition({ force: true });
      [16, 50, 120, 240].forEach(scheduleForcedPositionUpdate);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("orgii-ui-scale-applied", handleUiScaleApplied);

    const scrollableParents: Element[] = [];
    let parent: Element | null = containerRef.current?.parentElement || null;
    while (parent) {
      const style = window.getComputedStyle(parent);
      if (
        style.overflow === "auto" ||
        style.overflow === "scroll" ||
        style.overflowY === "auto" ||
        style.overflowY === "scroll" ||
        style.overflowX === "auto" ||
        style.overflowX === "scroll"
      ) {
        scrollableParents.push(parent);
        parent.addEventListener("scroll", handleScroll, { passive: true });
      }
      parent = parent.parentElement;
    }

    scrollListenerRef.current = () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener(
        "orgii-ui-scale-applied",
        handleUiScaleApplied
      );
      scrollableParents.forEach((el) => {
        el.removeEventListener("scroll", handleScroll);
      });
      scaleUpdateTimers.forEach((timer) => window.clearTimeout(timer));
      scaleUpdateTimers.clear();
    };

    return () => {
      if (scrollListenerRef.current) {
        scrollListenerRef.current();
        scrollListenerRef.current = null;
      }
    };
  }, [
    containerRef,
    isWebviewCreated,
    isWebviewAvailable,
    debouncedUpdatePosition,
    updatePosition,
  ]);

  return { getContainerRect, updatePosition };
}
