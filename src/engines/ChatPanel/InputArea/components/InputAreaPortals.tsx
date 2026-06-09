import React from "react";

import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import type { CustomMentionOption } from "@src/engines/ChatPanel/hooks/useInputArea/types";
import type { MenuItemId, RecentFile } from "@src/scaffold/ContextMenu/config";
import type { SlashItem } from "@src/types/extensions";

import ContextMenuPortal from "./ContextMenuPortal";
import SlashCommandPortal from "./SlashCommandPortal";

interface InputAreaPortalsProps {
  contextMenuVisible: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onContextMenuClose: () => void;
  onAtSelect: (type: MenuItemId, value?: string, displayName?: string) => void;
  customMentionOptions: ReadonlyArray<CustomMentionOption>;
  onCustomMentionSelect: (option: CustomMentionOption) => void;
  atSearchQuery: string;
  contextMenuKeyboardOpened: boolean;
  recentFiles: RecentFile[];
  currentRepoPath?: string;
  contextMenuKeyboardHandlerRef: React.MutableRefObject<
    ((event: React.KeyboardEvent) => boolean) | null
  >;
  mentionTreePosition: "left" | "right";
  isEditMode: boolean;
  showSlashMenu: boolean;
  filteredSlashItems: SlashItem[];
  slashLoading: boolean;
  currentMode: AgentExecMode;
  slashQuery: string;
  onSlashCommandClose: () => void;
  onSlashSelect: (item: SlashItem) => void;
  onModeSelect: (mode: AgentExecMode) => void;
  slashCommandKeyboardHandlerRef: React.MutableRefObject<
    ((event: KeyboardEvent) => boolean) | null
  >;
  onImageUpload: () => void;
  showPlusSlashMenu: boolean;
  plusSlashQuery: string;
  onPlusSlashClose: () => void;
  onSlashAppendSelect: (item: SlashItem) => void;
  plusSlashCommandKeyboardHandlerRef: React.MutableRefObject<
    ((event: KeyboardEvent) => boolean) | null
  >;
  onPlusSlashQueryChange: (query: string) => void;
}

export const InputAreaPortals: React.FC<InputAreaPortalsProps> = ({
  contextMenuVisible,
  containerRef,
  onContextMenuClose,
  onAtSelect,
  customMentionOptions,
  onCustomMentionSelect,
  atSearchQuery,
  contextMenuKeyboardOpened,
  recentFiles,
  currentRepoPath,
  contextMenuKeyboardHandlerRef,
  mentionTreePosition,
  isEditMode,
  showSlashMenu,
  filteredSlashItems,
  slashLoading,
  currentMode,
  slashQuery,
  onSlashCommandClose,
  onSlashSelect,
  onModeSelect,
  slashCommandKeyboardHandlerRef,
  onImageUpload,
  showPlusSlashMenu,
  plusSlashQuery,
  onPlusSlashClose,
  onSlashAppendSelect,
  plusSlashCommandKeyboardHandlerRef,
  onPlusSlashQueryChange,
}) => {
  const portalPlacement = isEditMode ? "down" : "prefer-up";
  const menuAnchorSelector = isEditMode
    ? "[data-editor-slot]"
    : "[data-composer-menu-anchor]";

  return (
    <>
      <ContextMenuPortal
        visible={contextMenuVisible}
        containerRef={containerRef}
        onClose={onContextMenuClose}
        onSelect={onAtSelect}
        customMentionOptions={customMentionOptions}
        onCustomMentionSelect={onCustomMentionSelect}
        searchQuery={atSearchQuery}
        keyboardOpened={contextMenuKeyboardOpened}
        recentFiles={recentFiles}
        repoPath={currentRepoPath || undefined}
        keyboardHandlerRef={contextMenuKeyboardHandlerRef}
        treePosition={mentionTreePosition}
        placement={portalPlacement}
        anchorSelector={menuAnchorSelector}
      />

      <SlashCommandPortal
        visible={showSlashMenu}
        containerRef={containerRef}
        anchorSelector={menuAnchorSelector}
        placement={portalPlacement}
        items={filteredSlashItems}
        loading={slashLoading}
        currentMode={currentMode}
        searchQuery={slashQuery}
        onClose={onSlashCommandClose}
        onSelect={onSlashSelect}
        onModeSelect={onModeSelect}
        keyboardHandlerRef={slashCommandKeyboardHandlerRef}
        showActionFlyouts
        onImageUpload={onImageUpload}
      />

      <SlashCommandPortal
        visible={showPlusSlashMenu}
        containerRef={containerRef}
        anchorSelector={menuAnchorSelector}
        placement={portalPlacement}
        items={filteredSlashItems}
        loading={slashLoading}
        currentMode={currentMode}
        searchQuery={plusSlashQuery}
        onClose={onPlusSlashClose}
        onSelect={(item) => {
          onSlashAppendSelect(item);
          onPlusSlashClose();
        }}
        onModeSelect={(mode) => {
          onModeSelect(mode);
          onPlusSlashClose();
        }}
        keyboardHandlerRef={plusSlashCommandKeyboardHandlerRef}
        searchMode="header"
        showActionFlyouts
        onSearchQueryChange={onPlusSlashQueryChange}
        onImageUpload={() => {
          onPlusSlashClose();
          onImageUpload();
        }}
      />
    </>
  );
};
