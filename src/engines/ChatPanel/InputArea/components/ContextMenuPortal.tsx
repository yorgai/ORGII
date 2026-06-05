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
import type {
  ContextMenuCustomMentionOption,
  ContextMenuProps,
} from "@/src/scaffold/ContextMenu/types";
import React, { useRef } from "react";
import { createPortal } from "react-dom";

import type { FloatingPlacementStrategy } from "./floatingPlacement";
import { useFloatingPortalPosition } from "./useFloatingPortalPosition";

interface ContextMenuPortalProps {
  visible: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
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
  treePosition?: ContextMenuProps["treePosition"];
  placement?: FloatingPlacementStrategy;
  /** Optional descendant of containerRef to anchor the menu against. */
  anchorSelector?: string;
}

const ESTIMATED_DROPDOWN_HEIGHT = 260;

const ContextMenuPortal: React.FC<ContextMenuPortalProps> = ({
  visible,
  containerRef,
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
  treePosition = "left",
  placement = "prefer-up",
  anchorSelector,
}) => {
  const portalRef = useRef<HTMLDivElement>(null);
  const dropdownWidth = Number.parseFloat(STYLE_CONFIG.dropdownWidth);
  const { portalPosition, isPositioned } = useFloatingPortalPosition({
    visible,
    containerRef,
    floatingRef: portalRef,
    floatingWidth: dropdownWidth,
    fallbackHeight: ESTIMATED_DROPDOWN_HEIGHT,
    placement,
    anchorSelector,
    updateKey: searchQuery,
  });

  if (!visible || !isPositioned || !portalPosition) return null;

  return createPortal(
    // data-context-menu-portal lets the click-outside handler in
    // useInputAreaEffects recognise clicks anywhere in this shell (including
    // the paddingBottom gap) as "inside the menu", preventing spurious close.
    <div
      ref={portalRef}
      data-context-menu-portal
      className={`fixed z-[99999] ${
        portalPosition.placement === "down" ? "pt-0" : "pb-0"
      }`}
      style={{
        top: portalPosition.top,
        bottom: portalPosition.bottom,
        left: portalPosition.left,
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
