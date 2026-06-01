/**
 * DropdownOptionsRenderer
 *
 * Renders a list of DropdownOption[] with consistent styling,
 * keyboard highlight, multi-select checkboxes, loading/empty states.
 *
 * Used internally by Dropdown (options mode) and Select.
 */
import { Loader2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Checkbox from "@src/components/Checkbox";
import { SPINNER_TOKENS } from "@src/config/spinnerTokens";

import DropdownSelectedCheck from "./DropdownSelectedCheck";
import { DROPDOWN_CLASSES, DROPDOWN_PANEL } from "./tokens";
import type { DropdownOption, DropdownSelectValue } from "./types";

export interface DropdownOptionsRendererProps {
  options: DropdownOption[];
  value?: DropdownSelectValue;
  mode: "single" | "multiple";
  highlightedIndex: number;
  keyboardNavigated: boolean;
  onSelect: (option: DropdownOption) => void;
  loading?: boolean;
  emptyContent?: React.ReactNode;
  dropdownRender?: (menu: React.ReactNode) => React.ReactNode;
  /** Use the compact item style (`py-1.5 text-[13px]`) — pairs with mini Select. */
  compact?: boolean;
}

const DropdownOptionsRenderer: React.FC<DropdownOptionsRendererProps> = ({
  options,
  value,
  mode,
  highlightedIndex,
  keyboardNavigated,
  onSelect,
  loading = false,
  emptyContent,
  dropdownRender,
  compact = false,
}) => {
  const { t } = useTranslation();
  const isMultiple = mode === "multiple";

  let content: React.ReactNode;

  if (loading) {
    content = (
      <div className="select-loading">
        <Loader2 size={SPINNER_TOKENS.default} className="animate-spin" />
        <span>{t("actions.loading")}</span>
      </div>
    );
  } else if (options.length === 0) {
    content = emptyContent ?? (
      <div className="select-empty">
        <span>{t("placeholders.noOptions")}</span>
      </div>
    );
  } else {
    content = (
      <div
        className={`select-options-overlay flex min-h-0 flex-1 ${DROPDOWN_PANEL.optionsMaxHeightClass} flex-col ${DROPDOWN_PANEL.itemsGapClass} overflow-y-auto ${DROPDOWN_PANEL.paddingClass}`}
      >
        <div className={`flex flex-col ${DROPDOWN_PANEL.itemsGapClass}`}>
          {options.map((option, index) => {
            const isSelected = isMultiple
              ? Array.isArray(value) && value.includes(option.value)
              : value === option.value;
            const isHighlighted =
              keyboardNavigated && index === highlightedIndex;

            return (
              <div
                key={option.value}
                data-testid={option.dataTestId}
                className={[
                  compact
                    ? DROPDOWN_CLASSES.itemCompact
                    : DROPDOWN_CLASSES.item,
                  DROPDOWN_CLASSES.itemHover,
                  "w-full justify-between",
                  isSelected && DROPDOWN_CLASSES.itemSelected,
                  isHighlighted && "bg-fill-2",
                  option.disabled && DROPDOWN_CLASSES.itemDisabled,
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelect(option)}
              >
                {isMultiple && (
                  <Checkbox checked={isSelected} className="size-4 shrink-0" />
                )}
                <span className="flex min-w-0 flex-1 items-center justify-between gap-2 overflow-hidden">
                  <span
                    className={
                      isSelected
                        ? "truncate text-primary-6"
                        : "truncate text-text-1"
                    }
                  >
                    {option.label}
                  </span>
                  {option.secondaryText && (
                    <span className="shrink-0 text-[11px] text-text-2">
                      {option.secondaryText}
                    </span>
                  )}
                  {!isMultiple && isSelected && <DropdownSelectedCheck />}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return <>{dropdownRender ? dropdownRender(content) : content}</>;
};

export default DropdownOptionsRenderer;
