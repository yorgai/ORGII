/**
 * InlineDropdown Component
 *
 * Generic inline dropdown for selecting from a list of options.
 * Uses shared useDropdownEngine hook and Tailwind tokens.
 */
import React, { useCallback } from "react";
import { createPortal } from "react-dom";

import DropdownSelectedCheck from "@src/components/Dropdown/DropdownSelectedCheck";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import Tooltip from "@src/components/Tooltip";
import { useDropdownEngine } from "@src/hooks/dropdown";
import type { DropdownOption } from "@src/types/core/shared";

// ============================================
// Size Configuration
// ============================================

const SIZE_CONFIG = {
  small: {
    trigger: "w-5 h-5 min-h-5 rounded-full p-0 gap-0",
    icon: "w-4 h-4",
  },
  medium: {
    trigger: "min-h-9 px-2 py-2 rounded-md gap-2.5 text-[12px]",
    icon: "w-4 h-4",
  },
} as const;

// ============================================
// Types
// ============================================

interface InlineDropdownProps<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void | Promise<void>;
  className?: string;
  showIcon?: boolean;
  showLabel?: boolean;
  size?: "small" | "medium";
}

// ============================================
// Component
// ============================================

function InlineDropdown<T extends string>({
  value,
  options,
  onChange,
  className = "",
  showIcon = true,
  showLabel = true,
  size = "small",
}: InlineDropdownProps<T>) {
  const {
    isOpen,
    isPositioned,
    toggle,
    close,
    triggerRef,
    panelRef,
    panelPosition,
  } = useDropdownEngine<HTMLButtonElement>({
    gap: DROPDOWN_PANEL.triggerGapTight,
    closeOnEsc: true,
    placement: "bottom",
  });

  const currentOption =
    options.find((opt) => opt.value === value) || options[0];

  const handleToggle = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      toggle();
    },
    [toggle]
  );

  const handleSelect = useCallback(
    (optionValue: T, event: React.MouseEvent) => {
      event.stopPropagation();
      void onChange(optionValue);
      close();
    },
    [onChange, close]
  );

  const sizeConfig = SIZE_CONFIG[size];

  return (
    <div
      className={`relative ${size === "small" ? "w-7" : "w-full"} flex items-center justify-center ${className}`}
    >
      <Tooltip
        content={currentOption.label}
        position="top"
        mouseEnterDelay={300}
        disabled={showLabel || isOpen}
      >
        <span className="flex items-center justify-center">
          <button
            ref={triggerRef}
            type="button"
            className={`flex cursor-pointer select-none items-center justify-center border-none bg-transparent text-text-1 hover:bg-fill-3 ${sizeConfig.trigger}`}
            onClick={handleToggle}
          >
            {showIcon && currentOption.icon && (
              <span
                className={`flex shrink-0 items-center justify-center ${sizeConfig.icon}`}
                style={
                  currentOption.color
                    ? { color: currentOption.color }
                    : undefined
                }
              >
                {currentOption.icon}
              </span>
            )}
            {showLabel && (
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {currentOption.label}
              </span>
            )}
          </button>
        </span>
      </Tooltip>

      {isOpen &&
        isPositioned &&
        createPortal(
          <div
            ref={panelRef}
            className={`${DROPDOWN_CLASSES.panel} ${DROPDOWN_WIDTHS.sidebarMenuClass} ${DROPDOWN_PANEL.paddingClass}`}
            style={{
              position: "fixed",
              top: `${panelPosition.top}px`,
              left: `${panelPosition.left}px`,
              zIndex: DROPDOWN_PANEL.zIndex,
            }}
          >
            <div className={DROPDOWN_CLASSES.itemsColumn}>
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={[
                    DROPDOWN_CLASSES.item,
                    "w-full text-left",
                    option.value === value
                      ? DROPDOWN_CLASSES.itemSelected
                      : DROPDOWN_CLASSES.itemHover,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={(event) => handleSelect(option.value, event)}
                >
                  {option.icon && (
                    <span
                      className="flex w-4 shrink-0 items-center justify-center"
                      style={option.color ? { color: option.color } : undefined}
                    >
                      {option.icon}
                    </span>
                  )}
                  <span className="flex-1">{option.label}</span>
                  {option.value === value && <DropdownSelectedCheck />}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export default InlineDropdown;
