/**
 * SelectGhostTrigger
 *
 * Ghost-variant trigger that visually matches `Select` with
 * `size="small"`, `variant="ghost"`, and `radius="lg"` — the same
 * configuration used by Source Control header filter selects.
 *
 * Use when a custom droplist (`Dropdown` droplist mode, spotlight palette,
 * etc.) must share the compact workstation-header select appearance
 * without adopting `Select`'s built-in option panel.
 */
import { ChevronDown } from "lucide-react";
import React, { forwardRef } from "react";

import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import { RADIUS_CLASS_MAP } from "./config";
import "./index.scss";

export interface SelectGhostTriggerProps {
  /** Trigger body (label, breadcrumb segments, count text, etc.). */
  value: React.ReactNode;
  /** Whether the associated panel is open (drives background + chevron). */
  open?: boolean;
  /** @default 'small' */
  size?: "mini" | "small" | "default" | "large";
  /** @default 'lg' */
  radius?: keyof typeof RADIUS_CLASS_MAP;
  disabled?: boolean;
  className?: string;
  selectorClassName?: string;
  style?: React.CSSProperties;
  title?: string;
  ariaLabel?: string;
  dataTestId?: string;
}

const SelectGhostTrigger = forwardRef<
  HTMLButtonElement,
  SelectGhostTriggerProps
>(function SelectGhostTrigger(
  {
    value,
    open = false,
    size = "small",
    radius = "lg",
    disabled = false,
    className = "",
    selectorClassName = "",
    style,
    title,
    ariaLabel,
    dataTestId,
  },
  ref
) {
  const { isDark } = useCurrentTheme();
  const radiusClass = RADIUS_CLASS_MAP[radius];

  const wrapperClasses = [
    "select-wrapper",
    "select-ghost",
    `select-size-${size}`,
    disabled && "select-disabled",
    open && "select-open",
    isDark && "select-dark",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type="button"
      className={wrapperClasses}
      style={{
        ...style,
        appearance: "none",
        background: "transparent",
        border: "none",
        padding: 0,
        textAlign: "left",
      }}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      data-testid={dataTestId}
    >
      <div className={`select-selector ${radiusClass} ${selectorClassName}`}>
        <span className="select-value">{value}</span>
        <div className="select-suffix">
          <ChevronDown
            size={12}
            className={`select-arrow shrink-0 text-text-3 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </div>
      </div>
    </button>
  );
});

export default SelectGhostTrigger;
