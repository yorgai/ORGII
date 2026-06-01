/**
 * InlineDropdown Component
 *
 * Inline-styled dropdown using the existing Dropdown component.
 * Shows as underlined text that opens a proper dropdown when clicked.
 * Uses the same styling as Select component for consistency.
 *
 * @example
 * Start intake stage with <InlineDropdown value="orgii" options={agents} onChange={...} />
 */
import cn from "classnames";
import { ChevronDown, Inbox, Loader2, Search } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import Dropdown from "@src/components/Dropdown";
import DropdownSelectedCheck from "@src/components/Dropdown/DropdownSelectedCheck";
import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import "@src/components/Select/index.scss";
import { SPINNER_TOKENS } from "@src/config/spinnerTokens";

import type { DropdownOption } from "../../types/workflow";

// ============================================
// Types
// ============================================

export interface InlineDropdownProps {
  value?: string;
  onChange: (value: string, extra?: unknown) => void;
  options: DropdownOption[];
  placeholder?: string;
  loading?: boolean;
  className?: string;
  showSearch?: boolean;
  emptyText?: string;
  /** Background color variant for hover/active states */
  bgVariant?: "fill-2" | "bg-2";
}

// ============================================
// Component
// ============================================

function InlineDropdown({
  value,
  onChange,
  options,
  placeholder = "select",
  loading = false,
  className = "",
  showSearch = false,
  emptyText = "No options",
  bgVariant = "bg-2",
}: InlineDropdownProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Find selected option
  const selectedOption = options.find((opt) => opt.value === value);
  const displayLabel = selectedOption?.label || placeholder;

  // Filter options based on search
  const filteredOptions = useMemo(() => {
    if (!searchQuery) return options;
    return options.filter((opt) =>
      opt.label.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [options, searchQuery]);

  const handleSelect = useCallback(
    (opt: DropdownOption) => {
      if (opt.disabled) return;
      onChange(opt.value, opt.extra);
      setIsOpen(false);
      setSearchQuery("");
    },
    [onChange]
  );

  // Dropdown menu content - using Select component classes
  const droplistContent = (
    <div className="select-dropdown rounded-lg border border-border-2 bg-bg-2">
      {/* Search */}
      {showSearch && (
        <div className="select-search">
          <Search size={14} />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search..."
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}

      {/* Options */}
      {loading ? (
        <div className="select-loading">
          <Loader2 size={SPINNER_TOKENS.default} className="animate-spin" />
          <span>Loading...</span>
        </div>
      ) : filteredOptions.length === 0 ? (
        <div className="select-empty">
          <Inbox size={24} className="opacity-40" />
          <span>{emptyText}</span>
        </div>
      ) : (
        <div className={DROPDOWN_CLASSES.optionsContainer}>
          {filteredOptions.map((opt) => (
            <div
              key={opt.value}
              onClick={() => handleSelect(opt)}
              className={cn(
                DROPDOWN_CLASSES.item,
                DROPDOWN_CLASSES.itemHover,
                value === opt.value && DROPDOWN_CLASSES.itemSelected,
                opt.disabled && DROPDOWN_CLASSES.itemDisabled
              )}
            >
              {opt.icon &&
                React.createElement(opt.icon, {
                  size: 14,
                  className: "shrink-0",
                })}
              <span className="flex-1 truncate">{opt.label}</span>
              {value === opt.value && <DropdownSelectedCheck />}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const hoverBgClass =
    bgVariant === "bg-2" ? "hover:bg-bg-2" : "hover:bg-fill-2";
  const activeBgClass = bgVariant === "bg-2" ? "bg-bg-2" : "bg-fill-2";

  return (
    <Dropdown
      droplist={droplistContent}
      trigger="click"
      position="bottom-start"
      popupVisible={isOpen}
      onVisibleChange={(visible) => {
        setIsOpen(visible);
        if (!visible) setSearchQuery("");
      }}
    >
      <span
        className={cn(
          "group inline-flex h-[24px] cursor-pointer items-center gap-0.5 rounded-full px-2 text-[14px] font-medium text-primary-6 transition-all duration-200 focus:outline-none",
          hoverBgClass,
          isOpen && activeBgClass,
          className
        )}
      >
        <span>{displayLabel}</span>
        <ChevronDown
          size={14}
          className={cn("transition-transform", isOpen && "rotate-180")}
        />
      </span>
    </Dropdown>
  );
}

export default InlineDropdown;
