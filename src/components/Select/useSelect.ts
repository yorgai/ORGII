/**
 * useSelect Hook (simplified)
 *
 * Manages only value state, selected options lookup, and clear handler.
 * All dropdown behavior (positioning, click-outside, ESC, keyboard, search)
 * is now handled by useDropdownEngine, useDropdownKeyboard, and
 * DropdownOptionsRenderer from the Dropdown module.
 */
import { type MouseEvent, useCallback, useMemo, useState } from "react";

import type { DropdownOption } from "@src/components/Dropdown/types";

import type { SelectOption, SelectOptionGroup, SelectProps } from "./types";

export interface UseSelectOptions {
  value: SelectProps["value"];
  defaultValue: SelectProps["defaultValue"];
  onChange: SelectProps["onChange"];
  mode: "single" | "multiple";
  options: (SelectOption | SelectOptionGroup)[];
  onClear: SelectProps["onClear"];
}

export function useSelect({
  value,
  defaultValue,
  onChange,
  mode,
  options,
  onClear,
}: UseSelectOptions) {
  const isMultiple = mode === "multiple";
  const isControlled = value !== undefined;

  const [internalValue, setInternalValue] = useState(
    defaultValue || (isMultiple ? [] : "")
  );

  const currentValue = isControlled ? value : internalValue;

  const flatOptions = useMemo(() => {
    const flat: SelectOption[] = [];
    options.forEach((opt) => {
      if ("options" in opt) {
        flat.push(...opt.options);
      } else {
        flat.push(opt);
      }
    });
    return flat;
  }, [options]);

  const selectedOptions = useMemo(() => {
    if (isMultiple) {
      const values = Array.isArray(currentValue) ? currentValue : [];
      return flatOptions.filter((opt) => values.includes(opt.value));
    } else {
      return flatOptions.find((opt) => opt.value === currentValue);
    }
  }, [currentValue, flatOptions, isMultiple]);

  const handleSelect = useCallback(
    (option: DropdownOption) => {
      if (option.disabled) return;

      let newValue: string | number | (string | number)[];
      let newOption: SelectOption | SelectOption[];

      if (isMultiple) {
        const values = Array.isArray(currentValue) ? currentValue : [];
        if (values.includes(option.value)) {
          newValue = values.filter((item) => item !== option.value);
          newOption = (selectedOptions as SelectOption[]).filter(
            (selectedOption) => selectedOption.value !== option.value
          );
        } else {
          newValue = [...values, option.value];
          newOption = [...(selectedOptions as SelectOption[]), option];
        }
      } else {
        newValue = option.value;
        newOption = option as SelectOption;
      }

      if (!isControlled) {
        setInternalValue(newValue);
      }

      onChange?.(newValue, newOption);

      return !isMultiple;
    },
    [isMultiple, currentValue, selectedOptions, isControlled, onChange]
  );

  const handleClear = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();

      if (isMultiple) {
        const newValue: (string | number)[] = [];
        const newOption: SelectOption[] = [];
        if (!isControlled) {
          setInternalValue(newValue);
        }
        onChange?.(newValue, newOption);
      } else {
        const newValue = "";
        if (!isControlled) {
          setInternalValue(newValue);
        }
        onChange?.(newValue, undefined as unknown as SelectOption);
      }

      onClear?.();
    },
    [isMultiple, isControlled, onChange, onClear]
  );

  return {
    currentValue,
    isMultiple,
    flatOptions,
    selectedOptions,
    handleSelect,
    handleClear,
  };
}
