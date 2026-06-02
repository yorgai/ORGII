/**
 * DropdownItem Component
 *
 * Base dropdown item with consistent styling.
 * Use this for menu items, select options, etc.
 *
 * @example
 * ```tsx
 * import { DropdownItem } from "@src/components/Dropdown";
 *
 * // Basic usage
 * <DropdownItem onClick={() => handleSelect("option1")}>
 *   Option 1
 * </DropdownItem>
 *
 * // With icon and selected state
 * <DropdownItem
 *   icon={<Settings size={DROPDOWN_ITEM.iconSize} />}
 *   selected={currentValue === "settings"}
 *   onClick={() => handleSelect("settings")}
 * >
 *   Settings
 * </DropdownItem>
 *
 * // With suffix (e.g., checkmark, shortcut)
 * <DropdownItem
 *   suffix={<Check size={DROPDOWN_ITEM.iconSize} />}
 *   selected
 * >
 *   Selected Option
 * </DropdownItem>
 * ```
 */
import { Check } from "lucide-react";
import React, { forwardRef, memo } from "react";

import DropdownSelectedCheck from "./DropdownSelectedCheck";
import { DROPDOWN_CLASSES, DROPDOWN_ITEM } from "./tokens";

export interface DropdownItemProps {
  /**
   * Item content/label
   */
  children: React.ReactNode;

  /**
   * Icon element (displayed before label)
   */
  icon?: React.ReactNode;

  /**
   * Suffix element (displayed after label, e.g., checkmark, shortcut)
   */
  suffix?: React.ReactNode;

  /**
   * Whether this item is selected
   * @default false
   */
  selected?: boolean;

  /**
   * Whether to show a checkmark when `selected`. Defaults to `true` because
   * the selected state no longer has a background fill — the checkmark is now
   * the primary selected indicator. A caller-supplied `suffix` always takes
   * precedence over the trailing checkmark.
   * @default true
   */
  showCheckmark?: boolean;

  /**
   * Controls where the selected check appears. Defaults to the existing
   * trailing placement; `icon` replaces the leading icon with a check.
   * @default "trailing"
   */
  selectedCheckPlacement?: "trailing" | "icon";

  /**
   * Whether this item is disabled
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether this item is highlighted (keyboard navigation)
   * @default false
   */
  highlighted?: boolean;

  /**
   * Click handler
   */
  onClick?: () => void;

  /**
   * Mouse enter handler (for hover/highlight)
   */
  onMouseEnter?: () => void;

  /**
   * Additional class name
   */
  className?: string;

  /**
   * Stable selector for rendered UI tests.
   */
  dataTestId?: string;

  /**
   * Additional style
   */
  style?: React.CSSProperties;
}

const DropdownItemInner = forwardRef<HTMLDivElement, DropdownItemProps>(
  (
    {
      children,
      icon,
      suffix,
      selected = false,
      showCheckmark = true,
      selectedCheckPlacement = "trailing",
      disabled = false,
      highlighted = false,
      onClick,
      onMouseEnter,
      className = "",
      dataTestId,
      style,
    },
    ref
  ) => {
    const handleClick = () => {
      if (disabled) return;
      onClick?.();
    };

    const itemClasses = [
      DROPDOWN_CLASSES.item,
      !disabled && DROPDOWN_CLASSES.itemHover,
      // Only keyboard `highlighted` gets a filled background. The `selected`
      // state is shown by the checkmark + primary-6 text only (no bg fill).
      highlighted && !disabled && "bg-fill-2",
      selected && DROPDOWN_CLASSES.itemSelected,
      disabled && DROPDOWN_CLASSES.itemDisabled,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        ref={ref}
        className={itemClasses}
        data-testid={dataTestId}
        style={style}
        onClick={handleClick}
        onMouseEnter={onMouseEnter}
        role="option"
        aria-selected={selected}
        aria-disabled={disabled}
      >
        {/* Icon */}
        {icon && (
          <span
            className={`flex-shrink-0 ${selected ? "text-primary-6" : "text-text-2"}`}
          >
            {showCheckmark && selected && selectedCheckPlacement === "icon" ? (
              <Check
                size={DROPDOWN_ITEM.iconSize}
                strokeWidth={2.25}
                className="shrink-0 text-primary-6"
              />
            ) : (
              icon
            )}
          </span>
        )}

        {/* Label */}
        <span className={`flex-1 truncate ${selected ? "text-primary-6" : ""}`}>
          {children}
        </span>

        {/* Suffix or Checkmark */}
        {(suffix ||
          (showCheckmark &&
            selected &&
            selectedCheckPlacement === "trailing")) && (
          <span
            className={`flex-shrink-0 ${selected ? "text-primary-6" : "text-text-3"}`}
          >
            {suffix || (showCheckmark && selected && <DropdownSelectedCheck />)}
          </span>
        )}
      </div>
    );
  }
);

DropdownItemInner.displayName = "DropdownItem";

// Memoize to prevent unnecessary re-renders in dropdown lists
const DropdownItem = memo(DropdownItemInner);

export default DropdownItem;

// ==============================================
// DropdownItemGroup - For grouped items
// ==============================================

export interface DropdownItemGroupProps {
  /**
   * Group label
   */
  label: string;

  /**
   * Group items
   */
  children: React.ReactNode;

  /**
   * Additional class name
   */
  className?: string;
}

export const DropdownItemGroup: React.FC<DropdownItemGroupProps> = ({
  label,
  children,
  className = "",
}) => {
  return (
    <div className={className}>
      <div className={DROPDOWN_CLASSES.sectionLabel}>{label}</div>
      {children}
    </div>
  );
};

DropdownItemGroup.displayName = "DropdownItemGroup";
