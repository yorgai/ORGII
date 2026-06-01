/**
 * useCountrySelect Hook
 *
 * Returns Select-compatible props for a searchable country selector.
 * Features: localized country names via geo:countries.{code},
 * language-pinned countries at the top, search by name or ISO code.
 *
 * @example
 * ```tsx
 * const countryProps = useCountrySelect({ value: loc, onChange: setLoc });
 * <Select {...countryProps} />
 * ```
 */
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";

import type { SelectOption, SelectProps } from "@src/components/Select/types";
import {
  COUNTRY_OPTIONS,
  PINNED_COUNTRIES_BY_LANGUAGE,
} from "@src/config/countries";

// ============================================
// Types
// ============================================

export interface UseCountrySelectOptions {
  /** Current country code (ISO 3166-1 alpha-2, e.g. "US") */
  value: string | undefined;
  /** Called when user selects a country */
  onChange: (value: string) => void;
  /** Select size */
  size?: "mini" | "small" | "default" | "large";
  /** Placeholder text override */
  placeholder?: string;
  /** Prefix element (icon, etc.) */
  prefix?: ReactNode;
  /** Custom width style */
  style?: CSSProperties;
}

// ============================================
// Hook
// ============================================

export function useCountrySelect({
  value,
  onChange,
  size = "default",
  placeholder,
  prefix,
  style,
}: UseCountrySelectOptions): SelectProps {
  const { t: tGeo, i18n } = useTranslation("geo");

  /** Country options: pinned countries for active language first, then rest alphabetically */
  const options: SelectOption[] = useMemo(() => {
    const lang = i18n.language?.split("-")[0] || "en";
    const pinnedCodes = new Set(PINNED_COUNTRIES_BY_LANGUAGE[lang] || []);

    const allOptions = COUNTRY_OPTIONS.map((country) => ({
      label: tGeo(`countries.${country.code}`) as string,
      value: country.code,
    }));

    const pinned = (PINNED_COUNTRIES_BY_LANGUAGE[lang] || [])
      .map((code) => allOptions.find((opt) => opt.value === code))
      .filter(Boolean) as typeof allOptions;

    const rest = allOptions
      .filter((opt) => !pinnedCodes.has(opt.value as string))
      .sort((optA, optB) =>
        String(optA.label).localeCompare(String(optB.label), lang, {
          sensitivity: "base",
        })
      );

    return [...pinned, ...rest];
  }, [tGeo, i18n.language]);

  /** Filter countries by translated name or code */
  const filterOption = useCallback(
    (inputValue: string, option: { value: string | number }) => {
      const label = tGeo(`countries.${option.value}`);
      const searchTerm = inputValue.toLowerCase();
      return (
        String(label).toLowerCase().includes(searchTerm) ||
        String(option.value).toLowerCase().includes(searchTerm)
      );
    },
    [tGeo]
  );

  const handleChange = useCallback(
    (selectedValue: string | number | (string | number)[]) => {
      onChange(String(selectedValue));
    },
    [onChange]
  );

  return {
    value,
    onChange: handleChange,
    options,
    showSearch: true,
    filterOption,
    size,
    style,
    prefix,
    placeholder,
  };
}
