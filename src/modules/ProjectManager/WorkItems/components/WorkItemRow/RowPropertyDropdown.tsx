import React from "react";

import {
  PropertyDropdownField,
  type PropertyDropdownOption,
  type PropertyDropdownTriggerVariant,
} from "@src/components/PropertyField/PropertyDropdownField";

export interface RowPropertyDropdownOption<
  T extends string,
> extends PropertyDropdownOption<T> {}

interface RowPropertyDropdownProps<T extends string> {
  value: T;
  label: string;
  icon: React.ReactNode;
  iconColor?: string;
  options: RowPropertyDropdownOption<T>[];
  onChange: (value: T) => void | Promise<void>;
  readonly?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  selected?: boolean;
  maxWidthClassName?: string;
  renderOptionIcon?: (option: RowPropertyDropdownOption<T>) => React.ReactNode;
  triggerVariant?: PropertyDropdownTriggerVariant;
}

export function RowPropertyDropdown<T extends string>({
  value,
  label,
  icon,
  iconColor,
  options,
  onChange,
  readonly = false,
  searchable = false,
  searchPlaceholder,
  selected = true,
  maxWidthClassName = "max-w-[180px]",
  renderOptionIcon,
  triggerVariant = "pill",
}: RowPropertyDropdownProps<T>) {
  return (
    <PropertyDropdownField
      value={value}
      label={label}
      icon={icon}
      iconColor={iconColor}
      options={options}
      onChange={onChange}
      readonly={readonly}
      searchable={searchable}
      searchPlaceholder={searchPlaceholder}
      selected={selected}
      maxWidthClassName={maxWidthClassName}
      triggerVariant={triggerVariant}
      fieldVariant="pill"
      placement="portal"
      borderless
      renderOptions={
        renderOptionIcon
          ? (searchQuery, close) => {
              const filtered =
                searchable && searchQuery
                  ? options.filter((option) =>
                      option.label
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase())
                    )
                  : options;
              return filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] text-text-1 transition-colors duration-150 hover:bg-fill-2 ${
                    option.value === value
                      ? "bg-fill-2 font-medium !text-primary-6 hover:!text-primary-6"
                      : ""
                  }`}
                  onClick={() => {
                    void onChange(option.value);
                    close();
                  }}
                >
                  {renderOptionIcon(option)}
                  <span className="flex-1 truncate">{option.label}</span>
                </button>
              ));
            }
          : undefined
      }
    />
  );
}
