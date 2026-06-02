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
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useMentionTreePosition } from "@src/hooks/workStation/panels/useMentionTreePosition";

interface ContextMenuPortalProps {
  visible: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelect: (type: MenuItemId, value?: string, displayName?: string) => void;
  customMentionOptions?: ReadonlyArray<ContextMenuCustomMentionOption>;
  onCustomMentionSelect?: (option: ContextMenuCustomMentionOption) => void;
  searchQuery: string;
  recentFiles: RecentFile[];
  repoPath?: string;
  keyboardHandlerRef: React.MutableRefObject<
    ((e: React.KeyboardEvent) => boolean) | null
  >;
}

const ContextMenuPortal: React.FC<ContextMenuPortalProps> = ({
  visible,
  containerRef,
  onClose,
  onSelect,
  customMentionOptions,
  onCustomMentionSelect,
  searchQuery,
  recentFiles,
  repoPath,
  keyboardHandlerRef,
}) => {
  const treePosition = useMentionTreePosition();
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
  });
  // Guard: only render after the position has been measured so the portal
  // never briefly appears at (0,0) / translateY(-100%) above the viewport.
  const [isPositioned, setIsPositioned] = useState(false);

  // Update dropdown position when it becomes visible
  useEffect(() => {
    if (visible && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: containerRect.top,
        left: containerRect.left,
      });
      setIsPositioned(true);
    } else {
      setIsPositioned(false);
    }
  }, [visible, containerRef]);

  // Recalculate on window resize and on layout changes to the container's
  // ancestor tree (e.g. panel resizes, Tauri window drag). A ResizeObserver
  // on the container's parent catches split-pane drags that don't emit a
  // window resize event.
  useEffect(() => {
    if (!visible) return;

    const recalc = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setDropdownPosition({
          top: rect.top,
          left: rect.left,
        });
      }
    };

    window.addEventListener("resize", recalc);

    const parent = containerRef.current?.parentElement;
    let ro: ResizeObserver | null = null;
    if (parent) {
      ro = new ResizeObserver(recalc);
      ro.observe(parent);
    }

    return () => {
      window.removeEventListener("resize", recalc);
      ro?.disconnect();
    };
  }, [visible, containerRef]);

  if (!visible || !isPositioned) return null;

  return createPortal(
    // data-context-menu-portal lets the click-outside handler in
    // useInputAreaEffects recognise clicks anywhere in this shell (including
    // the paddingBottom gap) as "inside the menu", preventing spurious close.
    <div
      data-context-menu-portal
      className="fixed z-[99999] pb-2"
      style={{
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: STYLE_CONFIG.dropdownWidth,
        transform: "translateY(-100%)",
      }}
    >
      <ContextMenu
        visible={visible}
        onClose={onClose}
        onSelect={onSelect}
        customMentionOptions={customMentionOptions}
        onCustomMentionSelect={onCustomMentionSelect}
        searchQuery={searchQuery}
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
