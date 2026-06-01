/**
 * SearchModeSelector Component
 *
 * Toggleable search mode selector for regex code search.
 */
import {
  Blend,
  Brain,
  Database,
  type LucideIcon,
  Search,
  TextSearch,
} from "lucide-react";
import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import type { CodeSearchMode } from "@src/hooks/workStation/search/useCodeSearch";
import { HEADER_BUTTON } from "@src/modules/WorkStation/shared/tokens";

// ============================================
// Types
// ============================================

export interface SearchModeSelectorProps {
  /** Current search mode */
  mode: CodeSearchMode;
  /** Callback when mode changes */
  onModeChange: (mode: CodeSearchMode) => void;
  /** Whether to include regex mode in the selector */
  showRegex?: boolean;
  /** Whether advanced search modes are available */
  advancedAvailable?: boolean;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Size variant */
  size?: "sm" | "md";
  /** Additional class name */
  className?: string;
}

// ============================================
// Constants
// ============================================

interface SearchModeConfig {
  id: CodeSearchMode;
  /** Not localized - technical terms */
  label: string;
  icon: LucideIcon;
  descriptionKey: string;
}

const SEARCH_MODES: SearchModeConfig[] = [
  {
    id: "regex",
    label: "Regex",
    icon: TextSearch,
    descriptionKey: "searchModes.regexDescription",
  },
  {
    id: "semantic",
    label: "Semantic",
    icon: Brain,
    descriptionKey: "searchModes.semanticDescription",
  },
  {
    id: "hybrid",
    label: "Hybrid",
    icon: Blend,
    descriptionKey: "searchModes.hybridDescription",
  },
  {
    id: "tantivy",
    label: "Tantivy",
    icon: Database,
    descriptionKey: "searchModes.tantivyDescription",
  },
];

// ============================================
// Component
// ============================================

export const SearchModeSelector: React.FC<SearchModeSelectorProps> = memo(
  ({
    mode,
    onModeChange,
    showRegex = false,
    advancedAvailable = false,
    disabled = false,
    size = "sm",
    className = "",
  }) => {
    const { t } = useTranslation();
    const modes = SEARCH_MODES.filter((modeItem) => {
      if (!showRegex && modeItem.id === "regex") return false;
      if (!advancedAvailable && modeItem.id !== "regex") return false;
      return true;
    });

    const handleModeClick = useCallback(
      (modeId: CodeSearchMode) => {
        if (!disabled && modeId !== mode) {
          onModeChange(modeId);
        }
      },
      [disabled, mode, onModeChange]
    );

    const iconSize = size === "sm" ? 14 : 16;
    const buttonPadding = size === "sm" ? "px-2 py-1" : "px-3 py-1.5";
    const fontSize = size === "sm" ? "text-[11px]" : "text-[12px]";

    return (
      <div
        className={`flex items-center gap-1 rounded-md bg-fill-1 p-0.5 ${className}`}
        role="radiogroup"
        aria-label={t("placeholders.searchMode")}
      >
        {modes.map((modeItem) => {
          const isActive = mode === modeItem.id;
          const Icon = modeItem.icon;

          return (
            <button
              key={modeItem.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => handleModeClick(modeItem.id)}
              disabled={disabled}
              title={t(modeItem.descriptionKey)}
              className={`flex items-center gap-1 rounded ${buttonPadding} ${fontSize} font-medium transition-colors ${
                isActive
                  ? "bg-bg-1 text-text-1 shadow-sm"
                  : "text-text-3 hover:text-text-2"
              } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} `}
            >
              <Icon size={iconSize} />
              <span>{modeItem.label}</span>
            </button>
          );
        })}
      </div>
    );
  }
);

SearchModeSelector.displayName = "SearchModeSelector";

// ============================================
// Compact Version (icon-only)
// ============================================

export interface SearchModeToggleProps {
  /** Current search mode */
  mode: CodeSearchMode;
  /** Callback to toggle to next mode */
  onToggle: () => void;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Size variant */
  size?: "sm" | "md";
  /** Additional class name */
  className?: string;
}

/**
 * Compact search mode toggle button (single button that cycles through modes)
 */
export const SearchModeToggle: React.FC<SearchModeToggleProps> = memo(
  ({ mode, onToggle, disabled = false, size = "sm", className = "" }) => {
    const { t } = useTranslation();
    const modeConfig = SEARCH_MODES.find((modeItem) => modeItem.id === mode);
    const Icon = modeConfig?.icon || Search;
    const iconSize = size === "sm" ? 14 : 16;
    const modeLabel = modeConfig ? modeConfig.label : "";

    return (
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        title={t("tooltips.searchModeCycle", { mode: modeLabel })}
        className={`${HEADER_BUTTON.action} ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${className ?? ""}`}
      >
        <Icon size={iconSize} />
      </button>
    );
  }
);

SearchModeToggle.displayName = "SearchModeToggle";

export default SearchModeSelector;
