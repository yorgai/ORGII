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
import { useAtomValue } from "jotai";
import React, { useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import {
  type WorkStationTab,
  mainPaneTabsAtom,
} from "@src/store/workstation/tabs";

import { getOpenedTabMentionOptions } from "../openedTabMentionOptions";
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

function getOpenedTabRecentFiles(
  workstationTabs: ReadonlyArray<WorkStationTab>
): RecentFile[] {
  return workstationTabs
    .filter(
      (tab) => tab.type === "file" && typeof tab.data.filePath === "string"
    )
    .map((tab) => ({
      path: tab.data.filePath as string,
      name: tab.title,
      type: "file" as const,
    }));
}

const VisibleContextMenuPortal: React.FC<
  Omit<ContextMenuPortalProps, "visible">
> = ({
  containerRef,
  onClose,
  onSelect,
  customMentionOptions,
  onCustomMentionSelect,
  searchQuery,
  inlineSearchOnEmpty,
  keyboardOpened,
  repoPath,
  keyboardHandlerRef,
  treePosition = "right",
  placement = "prefer-up",
  anchorSelector,
}) => {
  const portalRef = useRef<HTMLDivElement>(null);
  const workstationTabs = useAtomValue(mainPaneTabsAtom);
  const recentFiles = useMemo(
    () => getOpenedTabRecentFiles(workstationTabs),
    [workstationTabs]
  );
  const mergedCustomMentionOptions = useMemo(
    () => [
      ...getOpenedTabMentionOptions(workstationTabs),
      ...(customMentionOptions ?? []),
    ],
    [workstationTabs, customMentionOptions]
  );
  const dropdownWidth = Number.parseFloat(STYLE_CONFIG.dropdownWidth);
  const { portalPosition, isPositioned } = useFloatingPortalPosition({
    visible: true,
    containerRef,
    floatingRef: portalRef,
    floatingWidth: dropdownWidth,
    fallbackHeight: ESTIMATED_DROPDOWN_HEIGHT,
    placement,
    anchorSelector,
    updateKey: searchQuery,
  });

  if (!isPositioned || !portalPosition) return null;

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
        visible
        onClose={onClose}
        onSelect={onSelect}
        customMentionOptions={mergedCustomMentionOptions}
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

const ContextMenuPortal: React.FC<ContextMenuPortalProps> = ({
  visible,
  ...props
}) => {
  if (!visible) return null;
  return <VisibleContextMenuPortal {...props} />;
};

ContextMenuPortal.displayName = "ContextMenuPortal";

export default ContextMenuPortal;
