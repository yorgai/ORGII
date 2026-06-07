import React from "react";
import { createPortal } from "react-dom";

import DropdownSelectedCheck from "@src/components/Dropdown/DropdownSelectedCheck";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import type { AppearanceMode } from "@src/config/appearance/globalThemes";
import type { SupportedLanguage } from "@src/i18n";

import { SidebarWorkstationSettingsSubmenu } from "./SidebarWorkstationSettingsSubmenu";

export type SettingsSubmenu =
  | "appearance"
  | "language"
  | "chatPanelLocation"
  | "workstation";

export interface SubmenuPosition {
  left: number;
  bottom: number;
}

interface AppearanceOption {
  value: AppearanceMode;
  label: string;
}

interface ThemeOption {
  value: string | number;
  label: string;
}

interface LanguageOption {
  value: SupportedLanguage;
  label: string;
}

interface SidebarSettingsMenuSubmenusProps {
  activeSubmenu: SettingsSubmenu | null;
  appearanceMode: AppearanceMode;
  appearanceModeLabel: string;
  appearanceModeOptions: readonly AppearanceOption[];
  currentLanguage: SupportedLanguage;
  globalThemeId: string;
  languageOptions: readonly LanguageOption[];
  submenuPanelRef: React.Ref<HTMLDivElement>;
  submenuPosition: SubmenuPosition | null;
  themeOptions: readonly ThemeOption[];
  themePresetLabel: string;
  onSelectAppearanceMode: (mode: AppearanceMode) => void;
  onSelectLanguage: (language: SupportedLanguage) => void;
  onSelectTheme: (themeId: string) => void;
  onSubmenuMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onSubmenuPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function SidebarSettingsMenuSubmenus({
  activeSubmenu,
  appearanceMode,
  appearanceModeLabel,
  appearanceModeOptions,
  currentLanguage,
  globalThemeId,
  languageOptions,
  submenuPanelRef,
  submenuPosition,
  themeOptions,
  themePresetLabel,
  onSelectAppearanceMode,
  onSelectLanguage,
  onSelectTheme,
  onSubmenuMouseDown,
  onSubmenuPointerDown,
}: SidebarSettingsMenuSubmenusProps): React.ReactPortal | null {
  if (!activeSubmenu || !submenuPosition) return null;

  if (
    activeSubmenu === "chatPanelLocation" ||
    activeSubmenu === "workstation"
  ) {
    return createPortal(
      <SidebarWorkstationSettingsSubmenu
        panelRef={submenuPanelRef}
        position={submenuPosition}
        mode={activeSubmenu}
        onPointerDown={onSubmenuPointerDown}
        onMouseDown={onSubmenuMouseDown}
      />,
      document.body
    );
  }

  if (activeSubmenu === "appearance") {
    return createPortal(
      <div
        ref={submenuPanelRef}
        className={`${DROPDOWN_CLASSES.menuPanelWithHeaderBase} ${DROPDOWN_WIDTHS.panelWidthClass} fixed`}
        style={{ left: submenuPosition.left, bottom: submenuPosition.bottom }}
        onPointerDown={onSubmenuPointerDown}
        onMouseDown={onSubmenuMouseDown}
      >
        <div
          className={`${DROPDOWN_CLASSES.itemsColumnPadded} scrollbar-overlay max-h-[320px] overflow-y-auto`}
        >
          <div className={DROPDOWN_CLASSES.sectionLabel}>
            {appearanceModeLabel}
          </div>
          {appearanceModeOptions.map((option) => {
            const selected = appearanceMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`${DROPDOWN_CLASSES.menuActionItem} ${selected ? DROPDOWN_CLASSES.itemSelected : ""} justify-between`}
                onClick={() => onSelectAppearanceMode(option.value)}
                aria-selected={selected}
              >
                <span>{option.label}</span>
                {selected && <DropdownSelectedCheck />}
              </button>
            );
          })}
          <div className={DROPDOWN_CLASSES.menuSeparator} />
          <div className={DROPDOWN_CLASSES.sectionLabel}>
            {themePresetLabel}
          </div>
          {themeOptions.map((theme) => {
            const selected = globalThemeId === theme.value;
            return (
              <button
                key={theme.value}
                type="button"
                className={`${DROPDOWN_CLASSES.menuActionItem} ${selected ? DROPDOWN_CLASSES.itemSelected : ""} justify-between`}
                onClick={() => onSelectTheme(String(theme.value))}
                aria-selected={selected}
              >
                <span>{theme.label}</span>
                {selected && <DropdownSelectedCheck />}
              </button>
            );
          })}
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div
      ref={submenuPanelRef}
      className={`${DROPDOWN_CLASSES.menuPanelWithHeaderBase} ${DROPDOWN_WIDTHS.panelWidthClass} fixed`}
      style={{ left: submenuPosition.left, bottom: submenuPosition.bottom }}
      onPointerDown={onSubmenuPointerDown}
      onMouseDown={onSubmenuMouseDown}
    >
      <div className="scrollbar-overlay max-h-[320px] overflow-y-auto">
        <div className={DROPDOWN_CLASSES.itemsColumnPadded}>
          {languageOptions.map((language) => {
            const selected = currentLanguage === language.value;
            return (
              <button
                key={language.value}
                type="button"
                className={`${DROPDOWN_CLASSES.menuActionItem} ${selected ? DROPDOWN_CLASSES.itemSelected : ""} justify-between`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectLanguage(language.value);
                }}
                onClick={() => onSelectLanguage(language.value)}
                aria-selected={selected}
              >
                <span>{language.label}</span>
                {selected && <DropdownSelectedCheck />}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
