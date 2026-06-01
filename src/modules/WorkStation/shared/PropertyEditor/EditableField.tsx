/**
 * EditableField Component
 *
 * A small input field with label and optional unit suffix.
 * Used in property panels for editing numeric/string CSS values.
 *
 * Used by: WebDevTools DesignPanel, DesignerInspector
 */
import React, { memo, useCallback, useRef, useState } from "react";

import Input from "@src/components/Input";

// ============================================
// Types
// ============================================

export interface EditableFieldProps {
  /** Label text (e.g., "W", "H", "X") */
  label?: string;
  /** Icon element (alternative to label) */
  icon?: React.ReactNode;
  /** Current value */
  value: number | string;
  /** Unit suffix (e.g., "px", "%") */
  unit?: string;
  /** Change handler - receives value WITH unit */
  onChange: (value: string) => void;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Compact mode (smaller) */
  compact?: boolean;
  /** Minimum value (for number inputs) */
  min?: number;
  /** Maximum value (for number inputs) */
  max?: number;
  /** Step value (for number inputs) */
  step?: number;
}

// ============================================
// Component
// ============================================

export const EditableField: React.FC<EditableFieldProps> = memo(
  ({
    label,
    icon,
    value,
    unit,
    onChange,
    disabled = false,
    compact = false,
    min,
    max,
    step,
  }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [editingValue, setEditingValue] = useState<string | null>(null);
    const isEditing = editingValue !== null;

    const displayValue = isEditing ? editingValue : String(value);

    const handleChange = useCallback((newValue: string) => {
      setEditingValue(newValue);
    }, []);

    const handleBlur = useCallback(() => {
      if (editingValue === null) return;

      const newValue = editingValue.trim();
      if (newValue !== String(value)) {
        const numValue = parseFloat(newValue);
        if (!isNaN(numValue) && unit) {
          onChange(`${numValue}${unit}`);
        } else {
          onChange(newValue);
        }
      }

      setEditingValue(null);
    }, [editingValue, value, unit, onChange]);

    const handleFocus = useCallback(() => {
      setEditingValue(String(value));
    }, [value]);

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          inputRef.current?.blur();
        } else if (event.key === "Escape") {
          setEditingValue(null);
          inputRef.current?.blur();
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const currentNum = parseFloat(displayValue) || 0;
          const stepValue = step ?? 1;
          const delta = event.key === "ArrowUp" ? stepValue : -stepValue;
          let newNum = currentNum + delta;

          if (min !== undefined) newNum = Math.max(min, newNum);
          if (max !== undefined) newNum = Math.min(max, newNum);

          const newValue = String(newNum);
          setEditingValue(newValue);

          if (unit) {
            onChange(`${newNum}${unit}`);
          } else {
            onChange(newValue);
          }
        }
      },
      [displayValue, unit, onChange, min, max, step]
    );

    return (
      <Input
        ref={inputRef}
        size={compact ? "mini" : "small"}
        value={displayValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        prefix={
          icon ? (
            <span className="flex h-4 w-4 items-center justify-center text-text-2">
              {icon}
            </span>
          ) : label ? (
            <span className="flex h-4 w-4 items-center justify-center text-[11px] font-medium text-text-2">
              {label}
            </span>
          ) : undefined
        }
        suffix={
          unit ? (
            <span className="text-[10px] text-text-2">{unit}</span>
          ) : undefined
        }
        className="input-pane-surface"
      />
    );
  }
);

EditableField.displayName = "EditableField";

export default EditableField;
