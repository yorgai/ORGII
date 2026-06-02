/**
 * FileHeaderMoreMenu
 *
 * Renders the "More actions" dropdown surfaced by {@link FileHeader} via the
 * Ellipsis trailing icon. Groups menu entries into three semantic blocks:
 *
 *  - File change actions     — Save / Discard.
 *  - Menu actions            — Search / Go to line / Copy relative path / Reload.
 *  - Editor switches         — Line numbers / Word wrap / Minimap / Active-line
 *                              highlight / Git blame.
 *
 * Menu entries are always rendered for stable discoverability. Entries whose
 * backing action is not available in the current context are disabled.
 */
import {
  Copy,
  Ellipsis,
  Hash,
  RefreshCw,
  Save,
  Search,
  Settings,
  Undo2,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Dropdown from "@src/components/Dropdown";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import {
  KEYBOARD_SHORTCUT_VARIANT,
  KeyboardShortcut,
  KeyboardShortcutTooltipContent,
} from "@src/components/KeyboardShortcut";
import Switch from "@src/components/Switch";
import Tooltip from "@src/components/Tooltip";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { TabBarTrailingIconButton } from "@src/modules/WorkStation/shared/TabBar/components/TabBarTrailingIconButton";

interface MenuItemContentProps {
  icon?: React.ReactNode;
  label: React.ReactNode;
  shortcut?: string;
}

function MenuItemContent({ icon, label, shortcut }: MenuItemContentProps) {
  return (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      {shortcut && (
        <KeyboardShortcut
          shortcut={shortcut}
          variant={KEYBOARD_SHORTCUT_VARIANT.dropdown}
          className="ml-6 shrink-0"
        />
      )}
    </>
  );
}

export interface FileHeaderMoreMenuProps {
  // Visibility flags
  showReloadButton: boolean;
  showSearchAction: boolean;
  showGoToLineAction: boolean;
  showSaveAction: boolean;
  showDiscardAction: boolean;
  showCopyRelativePathAction: boolean;
  showLineNumbersToggle: boolean;
  showWordWrapToggle: boolean;
  showMinimapToggle: boolean;
  showHighlightActiveLineToggle: boolean;
  showGitBlameToggle: boolean;
  showMoreSettingsAction: boolean;

  // Toggle current values
  lineNumbersEnabled: boolean;
  wordWrapEnabled: boolean;
  minimapEnabled: boolean;
  highlightActiveLineEnabled: boolean;
  gitBlameEnabled: boolean;

  // States
  loading: boolean;
  hasUnsavedChanges: boolean;
  reloadSpinClass: string | undefined;
  reloadMenuCoolingDown: boolean;
  menuVisible: boolean;
  setMenuVisible: (visible: boolean) => void;

  // Handlers
  onSaveClick: () => void;
  onDiscardClick: () => void;
  onSearchClick: () => void;
  onGoToLineClick: () => void;
  onCopyRelativePathClick: () => void;
  onReloadClick: () => void;
  onLineNumbersChange: (enabled: boolean) => void;
  onWordWrapChange: (enabled: boolean) => void;
  onMinimapChange: (enabled: boolean) => void;
  onHighlightActiveLineChange: (enabled: boolean) => void;
  onGitBlameChange: (enabled: boolean) => void;
  onMoreSettingsClick: () => void;
}

export const FileHeaderMoreMenu: React.FC<FileHeaderMoreMenuProps> = ({
  showReloadButton,
  showSearchAction,
  showGoToLineAction,
  showSaveAction,
  showDiscardAction,
  showCopyRelativePathAction,
  showLineNumbersToggle,
  showWordWrapToggle,
  showMinimapToggle,
  showHighlightActiveLineToggle,
  showGitBlameToggle,
  showMoreSettingsAction,
  lineNumbersEnabled,
  wordWrapEnabled,
  minimapEnabled,
  highlightActiveLineEnabled,
  gitBlameEnabled,
  loading,
  hasUnsavedChanges,
  reloadSpinClass,
  reloadMenuCoolingDown,
  menuVisible,
  setMenuVisible,
  onSaveClick,
  onDiscardClick,
  onSearchClick,
  onGoToLineClick,
  onCopyRelativePathClick,
  onReloadClick,
  onLineNumbersChange,
  onWordWrapChange,
  onMinimapChange,
  onHighlightActiveLineChange,
  onGitBlameChange,
  onMoreSettingsClick,
}) => {
  const { t } = useTranslation();
  const searchShortcut = getShortcutKeys("find");
  const goToLineShortcut = getShortcutKeys("go_to_line");
  const saveShortcut = getShortcutKeys("save_file");
  const fileChangeActionsDisabled = !hasUnsavedChanges || loading;
  const saveDisabled = !showSaveAction || fileChangeActionsDisabled;
  const discardDisabled = !showDiscardAction || fileChangeActionsDisabled;
  const searchDisabled = !showSearchAction;
  const goToLineDisabled = !showGoToLineAction;
  const copyRelativePathDisabled = !showCopyRelativePathAction;
  const reloadDisabled = !showReloadButton || loading || reloadMenuCoolingDown;

  return (
    <Dropdown
      droplist={
        <div
          className={`${DROPDOWN_CLASSES.menuPanelBase} ${DROPDOWN_WIDTHS.wideMenuClass}`}
        >
          <button
            type="button"
            onClick={onSaveClick}
            disabled={saveDisabled}
            className={`${DROPDOWN_CLASSES.menuActionItem} ${
              saveDisabled ? DROPDOWN_CLASSES.itemDisabled : ""
            }`}
          >
            <MenuItemContent
              icon={<Save size={HEADER_ICON_SIZE.sm} />}
              label={t("common:actions.save")}
              shortcut={saveShortcut}
            />
          </button>

          <button
            type="button"
            onClick={onDiscardClick}
            disabled={discardDisabled}
            className={`${DROPDOWN_CLASSES.menuActionItem} ${
              discardDisabled ? DROPDOWN_CLASSES.itemDisabled : ""
            }`}
          >
            <MenuItemContent
              icon={<Undo2 size={HEADER_ICON_SIZE.sm} />}
              label={t("common:workstation.discardChanges")}
            />
          </button>

          <div className={DROPDOWN_CLASSES.menuSeparator} />

          <button
            type="button"
            onClick={onSearchClick}
            disabled={searchDisabled}
            className={`${DROPDOWN_CLASSES.menuActionItem} ${
              searchDisabled ? DROPDOWN_CLASSES.itemDisabled : ""
            }`}
          >
            <MenuItemContent
              icon={<Search size={HEADER_ICON_SIZE.sm} />}
              label={t("actions.search")}
              shortcut={searchShortcut}
            />
          </button>

          <button
            type="button"
            onClick={onGoToLineClick}
            disabled={goToLineDisabled}
            className={`${DROPDOWN_CLASSES.menuActionItem} ${
              goToLineDisabled ? DROPDOWN_CLASSES.itemDisabled : ""
            }`}
          >
            <MenuItemContent
              icon={<Hash size={HEADER_ICON_SIZE.sm} />}
              label={t("selectors.editorSpotlight.modes.goToLine.label")}
              shortcut={goToLineShortcut}
            />
          </button>

          <button
            type="button"
            onClick={onCopyRelativePathClick}
            disabled={copyRelativePathDisabled}
            className={`${DROPDOWN_CLASSES.menuActionItem} ${
              copyRelativePathDisabled ? DROPDOWN_CLASSES.itemDisabled : ""
            }`}
          >
            <MenuItemContent
              icon={<Copy size={HEADER_ICON_SIZE.sm} />}
              label={t("common:actions.copyRelativePath")}
            />
          </button>

          <button
            type="button"
            onClick={onReloadClick}
            disabled={reloadDisabled}
            className={`${DROPDOWN_CLASSES.menuActionItem} ${
              reloadDisabled ? DROPDOWN_CLASSES.itemDisabled : ""
            }`}
          >
            <MenuItemContent
              icon={
                <RefreshCw
                  size={HEADER_ICON_SIZE.sm}
                  className={reloadSpinClass}
                />
              }
              label={t("common:actions.refresh")}
            />
          </button>

          <div className={DROPDOWN_CLASSES.menuSeparator} />

          <div
            className={`${DROPDOWN_CLASSES.menuControlItem} ${
              showLineNumbersToggle ? "" : DROPDOWN_CLASSES.itemDisabled
            }`}
          >
            <span className="min-w-0 flex-1 truncate">
              {t("settings:editor.lineNumbers")}
            </span>
            <Switch
              size="small"
              checked={lineNumbersEnabled}
              disabled={!showLineNumbersToggle}
              onChange={onLineNumbersChange}
            />
          </div>

          <div
            className={`${DROPDOWN_CLASSES.menuControlItem} ${
              showWordWrapToggle ? "" : DROPDOWN_CLASSES.itemDisabled
            }`}
          >
            <span className="min-w-0 flex-1 truncate">
              {t("settings:editor.wordWrap")}
            </span>
            <Switch
              size="small"
              checked={wordWrapEnabled}
              disabled={!showWordWrapToggle}
              onChange={onWordWrapChange}
            />
          </div>

          <div
            className={`${DROPDOWN_CLASSES.menuControlItem} ${
              showMinimapToggle ? "" : DROPDOWN_CLASSES.itemDisabled
            }`}
          >
            <span className="min-w-0 flex-1 truncate">
              {t("settings:editor.minimap")}
            </span>
            <Switch
              size="small"
              checked={minimapEnabled}
              disabled={!showMinimapToggle}
              onChange={onMinimapChange}
            />
          </div>

          <div
            className={`${DROPDOWN_CLASSES.menuControlItem} ${
              showHighlightActiveLineToggle ? "" : DROPDOWN_CLASSES.itemDisabled
            }`}
          >
            <span className="min-w-0 flex-1 truncate">
              {t("settings:editor.highlightActiveLine")}
            </span>
            <Switch
              size="small"
              checked={highlightActiveLineEnabled}
              disabled={!showHighlightActiveLineToggle}
              onChange={onHighlightActiveLineChange}
            />
          </div>

          <div
            className={`${DROPDOWN_CLASSES.menuControlItem} ${
              showGitBlameToggle ? "" : DROPDOWN_CLASSES.itemDisabled
            }`}
          >
            <span className="min-w-0 flex-1 truncate">Git Blame</span>
            <Switch
              size="small"
              checked={gitBlameEnabled}
              disabled={!showGitBlameToggle}
              onChange={onGitBlameChange}
            />
          </div>

          <div className={DROPDOWN_CLASSES.menuSeparator} />

          <button
            type="button"
            onClick={onMoreSettingsClick}
            disabled={!showMoreSettingsAction}
            className={`${DROPDOWN_CLASSES.menuActionItem} ${
              showMoreSettingsAction ? "" : DROPDOWN_CLASSES.itemDisabled
            }`}
          >
            <MenuItemContent
              icon={<Settings size={HEADER_ICON_SIZE.sm} />}
              label={t("common:actions.moreSettings")}
            />
          </button>
        </div>
      }
      position="bottom-end"
      trigger="click"
      popupVisible={menuVisible}
      onVisibleChange={setMenuVisible}
    >
      <Tooltip
        content={
          <KeyboardShortcutTooltipContent label={t("common:actions.more")} />
        }
        position="bottom-end"
        mouseEnterDelay={200}
        disabled={menuVisible}
        framedPanel
      >
        <span className="inline-flex">
          <TabBarTrailingIconButton
            title={t("common:actions.more")}
            active={menuVisible}
            nativeTitle={false}
            className="flex-shrink-0"
          >
            <Ellipsis size={HEADER_ICON_SIZE.sm} strokeWidth={1.75} />
          </TabBarTrailingIconButton>
        </span>
      </Tooltip>
    </Dropdown>
  );
};
