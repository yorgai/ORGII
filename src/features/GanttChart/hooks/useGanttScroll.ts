/**
 * useGanttScroll Hook
 *
 * Synchronizes scrolling between sidebar, header, and timeline body.
 */
import { RefObject, useCallback } from "react";

export interface UseGanttScrollOptions {
  timelineBodyRef: RefObject<HTMLDivElement | null>;
  sidebarContentRef: RefObject<HTMLDivElement | null>;
  headerScrollRef?: RefObject<HTMLDivElement | null>;
}

export function useGanttScroll({
  timelineBodyRef,
  sidebarContentRef,
  headerScrollRef,
}: UseGanttScrollOptions) {
  const handleTimelineScroll = useCallback(() => {
    if (timelineBodyRef.current) {
      // Sync vertical scroll with sidebar
      if (sidebarContentRef.current) {
        sidebarContentRef.current.scrollTop = timelineBodyRef.current.scrollTop;
      }
      // Sync horizontal scroll with header
      if (headerScrollRef?.current) {
        headerScrollRef.current.scrollLeft = timelineBodyRef.current.scrollLeft;
      }
    }
  }, [timelineBodyRef, sidebarContentRef, headerScrollRef]);

  return { handleTimelineScroll };
}
