import type { DropdownOption, DropdownOptionGroup } from "./types";

export function flattenOptions(
  options: (DropdownOption | DropdownOptionGroup)[]
): DropdownOption[] {
  const flattenedOptions: DropdownOption[] = [];
  for (const option of options) {
    if ("options" in option) {
      flattenedOptions.push(...option.options);
    } else {
      flattenedOptions.push(option);
    }
  }
  return flattenedOptions;
}

export function defaultFilter(
  inputValue: string,
  option: DropdownOption
): boolean {
  return String(option.label).toLowerCase().includes(inputValue.toLowerCase());
}
