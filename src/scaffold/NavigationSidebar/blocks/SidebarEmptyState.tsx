/**
 * SidebarEmptyState
 *
 * Empty state component for sidebars.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import type { SidebarEmptyStateProps } from "../types";
import { renderSidebarIcon } from "../utils/renderIcon";

// ============================================
// SidebarEmptyState Component
// ============================================

const SidebarEmptyState: React.FC<SidebarEmptyStateProps> = ({
  config,
  searchQuery,
  theme,
  className = "",
}) => {
  const { t } = useTranslation("navigation");

  // Theme-aware styles
  const textStyle = theme ? { color: `${theme.foreground}60` } : undefined;

  // If there's a search query, show "no results" message
  if (searchQuery) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 text-text-1 ${className}`}
        style={textStyle}
      >
        <span className="text-[13px]">
          {t("sidebar.empty.noResultsFor", { query: searchQuery })}
        </span>
      </div>
    );
  }

  // Default empty state
  if (!config) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 text-text-1 ${className}`}
        style={textStyle}
      >
        <span className="text-[13px]">{t("sidebar.empty.noItems")}</span>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 text-text-1 ${className}`}
      style={textStyle}
    >
      {config.icon && (
        <div className="mb-1">
          {renderSidebarIcon(config.icon, {
            className: "text-text-1",
            size: 32,
          })}
        </div>
      )}
      {config.title && (
        <span className="text-[13px] font-medium">{config.title}</span>
      )}
      {config.description && (
        <span className="mt-1 max-w-[200px] text-center text-[11px] leading-relaxed text-text-2">
          {config.description}
        </span>
      )}
      {config.action && (
        <button
          onClick={config.action.onClick}
          className="mt-3 rounded-lg bg-primary-6 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-primary-5"
        >
          {config.action.label}
        </button>
      )}
    </div>
  );
};

export default SidebarEmptyState;
