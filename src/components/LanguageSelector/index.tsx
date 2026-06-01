/**
 * Language Selector Component
 *
 * Dropdown for selecting the application language.
 * Syncs with i18next and persists preference to settings.jsonc via languageAtom.
 *
 * @example
 * ```tsx
 * // In settings page
 * import { LanguageSelector } from "@src/components/LanguageSelector";
 *
 * <LanguageSelector />
 *
 * // Compact version for toolbar/header
 * <LanguageSelector size="small" variant="ghost" />
 * ```
 */
import { useSetAtom } from "jotai";
import { Globe } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Select from "@src/components/Select";
import type { SelectOption } from "@src/components/Select";
import {
  LANGUAGE_NAMES,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "@src/i18n";
import { languageAtom } from "@src/store/ui/languageAtom";

// ============================================================================
// TYPES
// ============================================================================

export interface LanguageSelectorProps {
  /**
   * Size of the selector
   * @default 'default'
   */
  size?: "mini" | "small" | "default" | "large";

  /**
   * Visual variant
   * @default 'default'
   */
  variant?: "default" | "ghost";

  /**
   * Show globe icon prefix
   * @default true
   */
  showIcon?: boolean;

  /**
   * Additional class name
   */
  className?: string;

  /**
   * Callback when language changes
   */
  onLanguageChange?: (language: SupportedLanguage) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function LanguageSelector({
  size = "default",
  variant = "default",
  showIcon = true,
  className,
  onLanguageChange,
}: LanguageSelectorProps) {
  const { i18n } = useTranslation();
  const setLanguagePreference = useSetAtom(languageAtom);

  // Build options from supported languages
  const options: SelectOption[] = useMemo(
    () =>
      SUPPORTED_LANGUAGES.map((lang) => ({
        value: lang,
        label: LANGUAGE_NAMES[lang],
      })),
    []
  );

  // Handle language change
  const handleChange = useCallback(
    (value: string | number | (string | number)[]) => {
      const newLang = value as SupportedLanguage;

      // Update i18next
      i18n.changeLanguage(newLang);

      // Persist to settings.jsonc + localStorage mirror
      setLanguagePreference(newLang);

      // Optional callback
      onLanguageChange?.(newLang);
    },
    [i18n, setLanguagePreference, onLanguageChange]
  );

  return (
    <Select
      value={i18n.language as SupportedLanguage}
      options={options}
      onChange={handleChange}
      size={size}
      variant={variant}
      prefix={showIcon ? <Globe className="h-4 w-4" /> : undefined}
      className={className}
      dropdownWidthMode="auto"
    />
  );
}

export default LanguageSelector;
