/**
 * ContextMenu Item Rendering Components
 *
 * Reusable item-level components for rendering menu items,
 * search result icons, and empty/loading states.
 */
import {
  FolderKanban,
  Globe,
  ListChecks,
  MessageSquare,
  Terminal,
} from "lucide-react";
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import FolderIcon from "@src/assets/fileTypeIcons/folder-base.svg";
import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import FileTypeIcon from "@src/components/FileTypeIcon";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

import {
  CONTEXT_MENU_ITEM_ROW,
  ICON_CONFIG,
  type SecondLayerId,
} from "./config";
import type { SearchResultItem } from "./types";

// ============================================
// Empty & Loading States
// ============================================

/** i18n-aware empty state for second layer panels */
export const SecondLayerEmptyState: React.FC<{ layerId: SecondLayerId }> = memo(
  ({ layerId }) => {
    const { t } = useTranslation();
    const emptyTextMap: Record<SecondLayerId, string> = {
      files: t("placeholders.typeToSearchFiles"),
      terminals: t("placeholders.noTerminalsAvailable"),
      sessions: t("placeholders.noSessionsFound"),
      browser: t("placeholders.noBrowserTabsOpen"),
      projects: t("placeholders.noProjectsFound", "No projects found"),
      codebase: t(
        "placeholders.typeToSearchCodebase",
        "Type to search codebase…"
      ),
    };
    return (
      <Placeholder
        variant="empty"
        title={emptyTextMap[layerId]}
        className="!h-auto"
      />
    );
  }
);
SecondLayerEmptyState.displayName = "SecondLayerEmptyState";

/** i18n-aware loading/empty state for search panels */
export const SearchLoadingOrEmpty: React.FC<{
  searchQuery: string;
  loading: boolean;
}> = memo(({ searchQuery, loading }) => {
  const { t } = useTranslation();
  if (loading) {
    return (
      <Placeholder
        variant="loading"
        title={t("status.searching")}
        className="!h-auto"
      />
    );
  }
  return (
    <Placeholder
      variant={searchQuery ? "no-results" : "empty"}
      title={
        searchQuery
          ? t("common:common.noResults")
          : t("placeholders.typeToSearch")
      }
      className="!h-auto"
    />
  );
});
SearchLoadingOrEmpty.displayName = "SearchLoadingOrEmpty";

// ============================================
// Icon Rendering
// ============================================

const iconAccent = (active: boolean) =>
  active
    ? "flex-shrink-0 text-primary-6"
    : "flex-shrink-0 text-text-2 group-hover:text-primary-6";

/** Render appropriate icon based on item type */
export const ResultItemIcon: React.FC<{
  item: SearchResultItem;
  displayName: string;
  /** Keyboard/hover row highlight */
  active?: boolean;
}> = memo(({ item, displayName, active = false }) => {
  if (item.iconType === "repo") {
    return (
      <ICON_CONFIG.repo
        size={16}
        strokeWidth={1.75}
        className={iconAccent(active)}
      />
    );
  }

  if (item.iconType === "branch") {
    return (
      <ICON_CONFIG.branch
        size={16}
        strokeWidth={1.75}
        className={iconAccent(active)}
      />
    );
  }

  if (item.iconType === "terminal") {
    return (
      <Terminal size={16} strokeWidth={1.75} className={iconAccent(active)} />
    );
  }

  if (item.iconType === "session") {
    return (
      <MessageSquare
        size={16}
        strokeWidth={1.75}
        className={iconAccent(active)}
      />
    );
  }

  if (item.iconType === "browser") {
    if (item.favicon) {
      return (
        <img
          src={item.favicon}
          alt=""
          className="h-4 w-4 flex-shrink-0 rounded-sm"
          onError={(e) => {
            e.currentTarget.style.display = "none";
            e.currentTarget.nextElementSibling?.classList.remove("hidden");
          }}
        />
      );
    }
    return (
      <Globe size={16} strokeWidth={1.75} className={iconAccent(active)} />
    );
  }

  if (item.iconType === "project") {
    return (
      <FolderKanban
        size={16}
        strokeWidth={1.75}
        className={iconAccent(active)}
      />
    );
  }

  if (item.iconType === "workitem") {
    return (
      <ListChecks size={16} strokeWidth={1.75} className={iconAccent(active)} />
    );
  }

  if (item.type === "folder") {
    return (
      <FolderIcon
        width="16"
        height="16"
        className={`flex-shrink-0 ${active ? "text-primary-6" : "text-text-2 group-hover:text-primary-6"}`}
      />
    );
  }

  return (
    <FileTypeIcon
      fileName={displayName}
      size="medium"
      className={`flex-shrink-0 ${active ? "text-primary-6" : "text-text-2 group-hover:text-primary-6"}`}
    />
  );
});
ResultItemIcon.displayName = "ResultItemIcon";

// ============================================
// Menu Item Row
// ============================================

export interface MenuItemRowProps {
  icon: React.ComponentType<Record<string, unknown>>;
  label: string;
  description?: string;
  hasArrow?: boolean;
  isActive?: boolean;
  dataTestId?: string;
  dataMentionId?: string;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const MenuItemRow: React.FC<MenuItemRowProps> = memo(
  ({
    icon,
    label,
    description,
    hasArrow = false,
    isActive = false,
    dataTestId,
    dataMentionId,
    onClick,
    onMouseEnter,
    onMouseLeave,
  }) => (
    <div
      data-testid={dataTestId}
      data-mention-id={dataMentionId}
      className={`${DROPDOWN_CLASSES.itemCompact} group cursor-pointer justify-between ${
        isActive
          ? CONTEXT_MENU_ITEM_ROW.selected
          : CONTEXT_MENU_ITEM_ROW.hoverIdle
      }`}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.();
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center gap-2">
        {React.createElement(icon, {
          size: 14,
          className: isActive
            ? "text-primary-6"
            : "text-text-2 group-hover:text-primary-6",
          strokeWidth: 1.75,
        })}
        <span
          className={`text-[13px] ${
            isActive
              ? "text-primary-6"
              : "text-text-1 group-hover:text-primary-6"
          }`}
        >
          {label}
        </span>
        {description && (
          <span
            className={`text-[11px] ${
              isActive
                ? "text-primary-6/80"
                : "text-text-3 group-hover:text-primary-6/80"
            }`}
          >
            {description}
          </span>
        )}
      </div>
      {hasArrow && (
        <ICON_CONFIG.arrow
          size={14}
          className={
            isActive
              ? "text-primary-6"
              : "text-text-3 group-hover:text-primary-6"
          }
          strokeWidth={1.75}
        />
      )}
    </div>
  )
);
MenuItemRow.displayName = "MenuItemRow";
