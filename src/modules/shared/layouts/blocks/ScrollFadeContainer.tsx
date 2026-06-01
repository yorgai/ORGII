/**
 * ScrollFadeContainer
 *
 * Scroll container that applies edge fade only when content overflows.
 * Drop-in replacement for overflow-y-auto divs in detail/main content panels.
 * Do NOT use for left/list panels — skip fade on those.
 */
import cn from "classnames";
import React, { forwardRef, useCallback, useRef } from "react";

import { useScrollFade } from "@src/hooks/ui/useScrollFade";

export interface ScrollFadeContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const ScrollFadeContainer = forwardRef<
  HTMLDivElement,
  ScrollFadeContainerProps
>(function ScrollFadeContainer(
  { className, children, ...props },
  forwardedRef
) {
  const innerRef = useRef<HTMLDivElement>(null);
  const scrollFadeClass = useScrollFade(innerRef);

  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      (innerRef as React.MutableRefObject<HTMLDivElement | null>).current =
        element;
      if (typeof forwardedRef === "function") {
        forwardedRef(element);
      } else if (forwardedRef) {
        forwardedRef.current = element;
      }
    },
    [forwardedRef]
  );

  return (
    <div ref={setRef} className={cn(className, scrollFadeClass)} {...props}>
      {children}
    </div>
  );
});

export default ScrollFadeContainer;
