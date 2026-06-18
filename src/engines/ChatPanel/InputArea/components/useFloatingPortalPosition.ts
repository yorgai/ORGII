import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type React from "react";

import {
  type FloatingPlacementStrategy,
  type FloatingPosition,
  computeFloatingPosition,
} from "./floatingPlacement";

const MAX_POSITION_RETRY_FRAMES = 4;

export interface UseFloatingPortalPositionOptions {
  visible: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  floatingRef: React.RefObject<HTMLElement | null>;
  floatingWidth?: number;
  fallbackHeight: number;
  placement?: FloatingPlacementStrategy;
  anchorSelector?: string;
  updateKey?: string | number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface UseFloatingPortalPositionResult {
  portalPosition: FloatingPosition | null;
  portalWidth: number;
  portalMaxHeight: number;
  isPositioned: boolean;
  updatePortalPosition: () => void;
}

export function useFloatingPortalPosition({
  visible,
  containerRef,
  floatingRef,
  floatingWidth,
  fallbackHeight,
  placement = "prefer-up",
  anchorSelector,
  updateKey,
  maxWidth,
  maxHeight,
}: UseFloatingPortalPositionOptions): UseFloatingPortalPositionResult {
  const [portalPosition, setPortalPosition] = useState<FloatingPosition | null>(
    null
  );
  const [portalWidth, setPortalWidth] = useState(floatingWidth ?? 0);
  const [portalMaxHeight, setPortalMaxHeight] = useState(
    maxHeight ?? fallbackHeight
  );
  const [isPositioned, setIsPositioned] = useState(false);

  const updatePortalPosition = useCallback(() => {
    if (!visible) {
      setIsPositioned(false);
      setPortalPosition(null);
      return;
    }

    const container = containerRef.current;
    const anchorElement =
      anchorSelector && container
        ? container.querySelector<HTMLElement>(anchorSelector)
        : null;
    const anchorRect = (anchorElement ?? container)?.getBoundingClientRect();
    const anchorReady = Boolean(
      anchorRect && anchorRect.width > 0 && anchorRect.height > 0
    );
    if (!anchorRect || !anchorReady) {
      setIsPositioned(false);
      setPortalPosition(null);
      return;
    }

    const measuredFloatingWidth = floatingWidth ?? anchorRect.width;
    const resolvedFloatingWidth = maxWidth
      ? Math.min(measuredFloatingWidth, maxWidth)
      : measuredFloatingWidth;
    const floatingHeight =
      floatingRef.current?.getBoundingClientRect().height ?? fallbackHeight;
    const nextPosition = computeFloatingPosition({
      anchorRect,
      floatingWidth: resolvedFloatingWidth,
      floatingHeight,
      placement,
    });

    setPortalPosition(nextPosition);
    setPortalWidth(resolvedFloatingWidth);
    setPortalMaxHeight(
      Math.min(maxHeight ?? fallbackHeight, nextPosition.availableHeight)
    );
    setIsPositioned(true);
  }, [
    anchorSelector,
    containerRef,
    fallbackHeight,
    floatingRef,
    floatingWidth,
    maxHeight,
    maxWidth,
    placement,
    visible,
  ]);

  // Initial/visibility measurement. Floating portals render only after
  // `isPositioned`, so scheduling this avoids a fallback-coordinate flash
  // without synchronously setting state inside the effect body.
  useLayoutEffect(() => {
    const frameIds: number[] = [];
    let frameCount = 0;
    const measure = () => {
      updatePortalPosition();
      frameCount += 1;
      if (frameCount < MAX_POSITION_RETRY_FRAMES) {
        frameIds.push(window.requestAnimationFrame(measure));
      }
    };
    frameIds.push(window.requestAnimationFrame(measure));
    return () => {
      frameIds.forEach((frameId) => window.cancelAnimationFrame(frameId));
    };
  }, [updatePortalPosition]);

  // Re-measure after content changes that can change the floating height.
  useLayoutEffect(() => {
    if (!visible || !isPositioned) return;

    const animationFrameId = window.requestAnimationFrame(updatePortalPosition);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [visible, isPositioned, updatePortalPosition, updateKey]);

  useEffect(() => {
    if (!visible) return;

    window.addEventListener("resize", updatePortalPosition);
    window.addEventListener("scroll", updatePortalPosition, true);

    const containerParent = containerRef.current?.parentElement;
    const floatingElement = floatingRef.current;
    let resizeObserver: ResizeObserver | null = null;
    if (containerParent || floatingElement) {
      resizeObserver = new ResizeObserver(updatePortalPosition);
      if (containerParent) resizeObserver.observe(containerParent);
      if (floatingElement) resizeObserver.observe(floatingElement);
    }

    return () => {
      window.removeEventListener("resize", updatePortalPosition);
      window.removeEventListener("scroll", updatePortalPosition, true);
      resizeObserver?.disconnect();
    };
  }, [containerRef, floatingRef, updatePortalPosition, visible]);

  return {
    portalPosition,
    portalWidth,
    portalMaxHeight,
    isPositioned,
    updatePortalPosition,
  };
}
