import { X } from "lucide-react";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import Markdown from "@src/components/MarkDown";

export interface CaptionBarProps {
  text: string;
  getPortalBounds?: () => { left: number; right: number } | null;
  textTone?: "default" | "primary";
}

const CaptionBar: React.FC<CaptionBarProps> = memo(
  ({ text, getPortalBounds, textTone = "default" }) => {
    const [hoverOpen, setHoverOpen] = useState(false);
    const [pinnedOpen, setPinnedOpen] = useState(false);
    const [panelPosition, setPanelPosition] = useState({
      top: 0,
      left: 0,
      width: 0,
      maxHeight: 240,
    });
    const rootRef = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const hoverCloseTimerRef = useRef<NodeJS.Timeout | null>(null);
    const panelOpen = hoverOpen || pinnedOpen;
    const collapsedTextClass =
      textTone === "primary" ? "text-primary-6" : "text-text-2";

    const updatePanelPosition = useCallback(() => {
      const node = rootRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const bounds = getPortalBounds?.() ?? {
        left: 12,
        right: window.innerWidth - 12,
      };
      const availableWidth = Math.max(160, bounds.right - bounds.left);
      const width = Math.min(600, availableWidth);
      const desiredCenter = rect.left + rect.width / 2;
      const halfWidth = width / 2;
      const left = Math.max(
        bounds.left + halfWidth,
        Math.min(desiredCenter, bounds.right - halfWidth)
      );
      const top = rect.bottom + 6;
      const maxHeight = Math.max(
        96,
        Math.min(240, window.innerHeight - top - 12)
      );
      setPanelPosition({ top, left, width, maxHeight });
    }, [getPortalBounds]);

    useEffect(() => {
      if (!panelOpen) return;
      updatePanelPosition();
      window.addEventListener("resize", updatePanelPosition);
      window.addEventListener("scroll", updatePanelPosition, true);
      return () => {
        window.removeEventListener("resize", updatePanelPosition);
        window.removeEventListener("scroll", updatePanelPosition, true);
      };
    }, [panelOpen, updatePanelPosition]);

    useEffect(() => {
      return () => {
        if (hoverCloseTimerRef.current) {
          clearTimeout(hoverCloseTimerRef.current);
        }
      };
    }, []);

    useEffect(() => {
      if (!pinnedOpen) return;
      const handleClick = (event: MouseEvent) => {
        const rootNode = rootRef.current;
        const panelNode = panelRef.current;
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (rootNode?.contains(target) || panelNode?.contains(target)) return;
        setPinnedOpen(false);
        setHoverOpen(false);
      };
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }, [pinnedOpen]);

    const clearHoverCloseTimer = useCallback(() => {
      if (hoverCloseTimerRef.current) {
        clearTimeout(hoverCloseTimerRef.current);
        hoverCloseTimerRef.current = null;
      }
    }, []);

    const handleOpenHover = useCallback(() => {
      clearHoverCloseTimer();
      setHoverOpen(true);
    }, [clearHoverCloseTimer]);

    const handleCloseHover = useCallback(() => {
      if (pinnedOpen) return;
      clearHoverCloseTimer();
      hoverCloseTimerRef.current = setTimeout(() => {
        setHoverOpen(false);
        hoverCloseTimerRef.current = null;
      }, 120);
    }, [clearHoverCloseTimer, pinnedOpen]);

    const handleToggle = useCallback(
      (event: React.MouseEvent) => {
        event.stopPropagation();
        clearHoverCloseTimer();
        setPinnedOpen((prev) => !prev);
        setHoverOpen(true);
      },
      [clearHoverCloseTimer]
    );

    const handleClosePinned = useCallback((event: React.MouseEvent) => {
      event.stopPropagation();
      setPinnedOpen(false);
      setHoverOpen(false);
    }, []);

    const expandedPanel = panelOpen
      ? createPortal(
          <div
            ref={panelRef}
            className="fixed z-[9999] -translate-x-1/2 rounded-lg border border-solid border-border-2 bg-chat-input px-3 py-1 text-text-1 shadow-md"
            style={{
              top: panelPosition.top,
              left: panelPosition.left,
              width: panelPosition.width,
              minHeight: 28,
            }}
            onMouseEnter={handleOpenHover}
            onMouseLeave={handleCloseHover}
            onClick={(event) => event.stopPropagation()}
          >
            {pinnedOpen ? (
              <button
                type="button"
                onClick={handleClosePinned}
                aria-label="Collapse"
                className="absolute right-1.5 top-1.5 flex h-[20px] w-[20px] cursor-pointer items-center justify-center rounded-full text-text-3 transition-colors hover:bg-fill-2 hover:text-text-1"
              >
                <X size={13} />
              </button>
            ) : null}
            <div
              className="chat-text overflow-y-auto pr-5 text-[13px] leading-relaxed text-text-1 scrollbar-hide"
              style={{ maxHeight: panelPosition.maxHeight }}
            >
              <Markdown
                textContent={text}
                useChatCodeBlock={true}
                enableFileNavigation={true}
                skipPreprocess={false}
              />
            </div>
          </div>,
          document.body
        )
      : null;

    return (
      <div
        ref={rootRef}
        className="pointer-events-auto relative min-w-0 max-w-[600px]"
        data-testid="simulator-caption-bar"
        onMouseEnter={handleOpenHover}
        onMouseLeave={handleCloseHover}
      >
        {expandedPanel}
        <button
          type="button"
          onClick={handleToggle}
          className={`flex h-7 max-w-full cursor-pointer items-center rounded-full bg-fill-2 px-3 text-[13px] transition-colors hover:bg-fill-3 hover:text-text-1 ${collapsedTextClass}`}
        >
          <span className="truncate">{text}</span>
        </button>
      </div>
    );
  }
);

CaptionBar.displayName = "CaptionBar";

export default CaptionBar;
