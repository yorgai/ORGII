/**
 * ScrollPreservation
 *
 * Wraps a scroll container to preserve scroll position across re-renders.
 * When clicking a row in Integrations tables, state updates cause re-renders
 * that can reset scroll. Saves scrollTop on scroll events and on click
 * (capture phase) so we have it before re-render; restores after layout
 * only when the DOM actually reset scroll (jumped to 0 unexpectedly).
 */
import React, { useCallback, useLayoutEffect, useRef } from "react";

export interface ScrollPreservationProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const JUMP_THRESHOLD = 1;

const ScrollPreservation: React.FC<ScrollPreservationProps> = ({
  children,
  onScroll,
  onClick,
  ...rest
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const savedScrollRef = useRef(0);
  const isUserScrollingRef = useRef(false);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      if (target?.scrollTop !== undefined) {
        savedScrollRef.current = target.scrollTop;
        isUserScrollingRef.current = true;
      }
      onScroll?.(event);
    },
    [onScroll]
  );

  const handleClickCapture = useCallback(() => {
    const el = ref.current;
    if (el?.scrollTop !== undefined) {
      savedScrollRef.current = el.scrollTop;
    }
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const saved = savedScrollRef.current;
    if (saved <= 0) return;

    if (isUserScrollingRef.current) {
      isUserScrollingRef.current = false;
      return;
    }

    const current = el.scrollTop;
    const delta = Math.abs(current - saved);
    if (delta < JUMP_THRESHOLD) return;

    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) return;

    const toRestore = Math.min(saved, maxScroll);
    el.scrollTop = toRestore;
  });

  return (
    <div
      ref={ref}
      onScroll={handleScroll}
      onClickCapture={handleClickCapture}
      onClick={onClick}
      {...rest}
    >
      {children}
    </div>
  );
};

export default ScrollPreservation;
