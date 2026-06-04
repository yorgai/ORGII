/**
 * ContextMenuPortal
 *
 * Renders the @ mention context menu via a React portal
 * to avoid clipping by parent overflow containers.
 */
import {
  type MenuItemId,
  type RecentFile,
  STYLE_CONFIG,
} from "@/src/scaffold/ContextMenu/config";
import { ContextMenu } from "@/src/scaffold/ContextMenu/exports";
import type { ContextMenuCustomMentionOption } from "@/src/scaffold/ContextMenu/types";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { DROPDOWN_PANEL } from "@src/components/Dropdown/tokens";
import { useMentionTreePosition } from "@src/hooks/workStation/panels/useMentionTreePosition";

interface ContextMenuPortalProps {
  visible: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  anchorPosition?: { x: number; y: number } | null;
  onClose: () => void;
  onSelect: (type: MenuItemId, value?: string, displayName?: string) => void;
  customMentionOptions?: ReadonlyArray<ContextMenuCustomMentionOption>;
  onCustomMentionSelect?: (option: ContextMenuCustomMentionOption) => void;
  searchQuery: string;
  inlineSearchOnEmpty?: boolean;
  keyboardOpened?: boolean;
  recentFiles: RecentFile[];
  repoPath?: string;
  keyboardHandlerRef: React.MutableRefObject<
    ((e: React.KeyboardEvent) => boolean) | null
  >;
}

type DropdownPlacement = "down" | "up";

interface DropdownPosition {
  top: number;
  left: number;
  placement: DropdownPlacement;
}

const ESTIMATED_DROPDOWN_HEIGHT = 260;
const VIEWPORT_MARGIN = 8;

function clampToViewport(
  value: number,
  size: number,
  viewportSize: number
): number {
  const maxValue = Math.max(
    VIEWPORT_MARGIN,
    viewportSize - size - VIEWPORT_MARGIN
  );
  return Math.min(Math.max(VIEWPORT_MARGIN, value), maxValue);
}

const ContextMenuPortal: React.FC<ContextMenuPortalProps> = ({
  visible,
  containerRef,
  anchorPosition,
  onClose,
  onSelect,
  customMentionOptions,
  onCustomMentionSelect,
  searchQuery,
  inlineSearchOnEmpty,
  keyboardOpened,
  recentFiles,
  repoPath,
  keyboardHandlerRef,
}) => {
  const treePosition = useMentionTreePosition();
  const portalRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition>({
    top: 0,
    left: 0,
    placement: "down",
  });
  const [isPositioned, setIsPositioned] = useState(false);

  const updateDropdownPosition = useCallback(() => {
    if (!visible) return;

    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) {
      setIsPositioned(false);
      return;
    }

    const dropdownWidth = Number.parseFloat(STYLE_CONFIG.dropdownWidth);
    const dropdownHeight =
      portalRef.current?.getBoundingClientRect().height ??
      ESTIMATED_DROPDOWN_HEIGHT;
    const anchorX = anchorPosition?.x ?? containerRect.left;
    const anchorY = anchorPosition?.y ?? containerRect.bottom;
    const gap = DROPDOWN_PANEL.triggerGap;
    const spaceBelow = window.innerHeight - anchorY - gap - VIEWPORT_MARGIN;
    const spaceAbove = anchorY - gap - VIEWPORT_MARGIN;
    const opensDown = dropdownHeight <= spaceBelow || spaceBelow >= spaceAbove;
    const unclampedTop = opensDown
      ? anchorY + gap
      : anchorY - dropdownHeight - gap;

    setDropdownPosition({
      top: clampToViewport(unclampedTop, dropdownHeight, window.innerHeight),
      left: clampToViewport(anchorX, dropdownWidth, window.innerWidth),
      placement: opensDown ? "down" : "up",
    });
    setIsPositioned(true);
  }, [anchorPosition, containerRef, visible]);

  useEffect(() => {
    if (visible) return;

    const timeoutId = window.setTimeout(() => setIsPositioned(false), 0);
    return () => window.clearTimeout(timeoutId);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    const animationFrameId = window.requestAnimationFrame(
      updateDropdownPosition
    );
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [visible, updateDropdownPosition]);

  useEffect(() => {
    if (!visible) return;

    window.addEventListener("scroll", updateDropdownPosition, true);
    window.addEventListener("resize", updateDropdownPosition);

    const parent = containerRef.current?.parentElement;
    let resizeObserver: ResizeObserver | null = null;
    if (parent) {
      resizeObserver = new ResizeObserver(updateDropdownPosition);
      resizeObserver.observe(parent);
    }

    return () => {
      window.removeEventListener("scroll", updateDropdownPosition, true);
      window.removeEventListener("resize", updateDropdownPosition);
      resizeObserver?.disconnect();
    };
  }, [visible, containerRef, updateDropdownPosition]);

  useEffect(() => {
    if (!visible || !isPositioned) return;

    const animationFrameId = window.requestAnimationFrame(
      updateDropdownPosition
    );
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [visible, isPositioned, searchQuery, updateDropdownPosition]);

  if (!visible || !isPositioned) return null;

  return createPortal(
    // data-context-menu-portal lets the click-outside handler in
    // useInputAreaEffects recognise clicks anywhere in this shell (including
    // the paddingBottom gap) as "inside the menu", preventing spurious close.
    <div
      ref={portalRef}
      data-context-menu-portal
      className={`fixed z-[99999] ${
        dropdownPosition.placement === "down" ? "pt-0" : "pb-0"
      }`}
      style={{
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: STYLE_CONFIG.dropdownWidth,
      }}
    >
      <ContextMenu
        visible={visible}
        onClose={onClose}
        onSelect={onSelect}
        customMentionOptions={customMentionOptions}
        onCustomMentionSelect={onCustomMentionSelect}
        searchQuery={searchQuery}
        inlineSearchOnEmpty={inlineSearchOnEmpty}
        keyboardOpened={keyboardOpened}
        recentFiles={recentFiles}
        repoPath={repoPath}
        keyboardHandlerRef={keyboardHandlerRef}
        treePosition={treePosition}
      />
    </div>,
    document.body
  );
};

ContextMenuPortal.displayName = "ContextMenuPortal";

export default ContextMenuPortal;
