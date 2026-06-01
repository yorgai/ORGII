import { useSetAtom } from "jotai";
import React, { useEffect, useLayoutEffect, useRef } from "react";

import {
  SHARED_BROWSER_HOST,
  SHARED_BROWSER_HOST_SCOPE,
  type SharedBrowserHostId,
  type SharedBrowserHostRect,
  type SharedBrowserHostScope,
  sharedBrowserHostRegistryAtom,
} from "./sharedBrowserHostAtoms";

interface SharedBrowserHostSlotProps {
  hostId: SharedBrowserHostId;
  scope?: SharedBrowserHostScope;
  active: boolean;
  className?: string;
  bottomInsetPx?: number;
  children?: React.ReactNode;
}

function getDefaultScope(hostId: SharedBrowserHostId): SharedBrowserHostScope {
  return hostId === SHARED_BROWSER_HOST.AGENT_STATION
    ? SHARED_BROWSER_HOST_SCOPE.AGENT_STATION
    : SHARED_BROWSER_HOST_SCOPE.MY_STATION;
}

function toHostRect(
  rect: DOMRect,
  bottomInsetPx: number
): SharedBrowserHostRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: Math.max(0, rect.height - bottomInsetPx),
  };
}

function sameRect(
  left: SharedBrowserHostRect | null,
  right: SharedBrowserHostRect | null
): boolean {
  if (!left || !right) return left === right;
  return (
    Math.abs(left.x - right.x) < 1 &&
    Math.abs(left.y - right.y) < 1 &&
    Math.abs(left.width - right.width) < 1 &&
    Math.abs(left.height - right.height) < 1
  );
}

export const SharedBrowserHostSlot: React.FC<SharedBrowserHostSlotProps> = ({
  hostId,
  scope = getDefaultScope(hostId),
  active,
  className = "h-full w-full",
  bottomInsetPx = 0,
  children,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const setRegistry = useSetAtom(sharedBrowserHostRegistryAtom);

  useLayoutEffect(() => {
    const element = hostRef.current;
    if (!element) return;

    let animationFrame: number | null = null;

    const publish = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        const nextRect = active
          ? toHostRect(element.getBoundingClientRect(), bottomInsetPx)
          : null;
        setRegistry((prev) => {
          const current = prev[hostId];
          if (
            current.scope === scope &&
            current.active === active &&
            sameRect(current.rect, nextRect)
          ) {
            return prev;
          }
          return {
            ...prev,
            [hostId]: {
              id: hostId,
              scope,
              active,
              rect: nextRect,
            },
          };
        });
      });
    };

    publish();
    const resizeObserver = new ResizeObserver(publish);
    resizeObserver.observe(element);
    window.addEventListener("resize", publish);
    window.addEventListener("scroll", publish, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", publish);
      window.removeEventListener("scroll", publish, true);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [active, bottomInsetPx, hostId, scope, setRegistry]);

  useEffect(() => {
    return () => {
      setRegistry((prev) => ({
        ...prev,
        [hostId]: {
          id: hostId,
          scope,
          active: false,
          rect: null,
        },
      }));
    };
  }, [hostId, scope, setRegistry]);

  return (
    <div ref={hostRef} className={className}>
      {children}
    </div>
  );
};

export default SharedBrowserHostSlot;
