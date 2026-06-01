/**
 * Atomic row components for SlashCommandMenu.
 * Each renders one list entry, taking its own data and shared active/hover state.
 */
import { ChevronRight, ImageIcon } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import DropdownSelectedCheck from "@src/components/Dropdown/DropdownSelectedCheck";
import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import type {
  AgentExecMode,
  AgentExecModeEntry,
} from "@src/config/sessionCreatorConfig";
import { MenuItemRow } from "@src/scaffold/ContextMenu/ResultItems";
import { CONTEXT_MENU_ITEM_ROW } from "@src/scaffold/ContextMenu/config";
import type { SlashItem, SlashItemCategory } from "@src/types/extensions";

import {
  ModeIcon as ModeIconComponent,
  ModelsIcon as ModelsIconComponent,
  categoryIcon,
} from "./constants";

// ── Shared ────────────────────────────────────────────────────────────────────

const activeClass = CONTEXT_MENU_ITEM_ROW.selected;
const idleClass = CONTEXT_MENU_ITEM_ROW.hoverIdle;

function rowClass(isActive: boolean): string {
  return `${DROPDOWN_CLASSES.itemCompact} group cursor-pointer ${isActive ? activeClass : idleClass}`;
}

function iconClass(isActive: boolean, extra = ""): string {
  return isActive
    ? `text-primary-6 ${extra}`
    : `text-text-2 group-hover:text-primary-6 ${extra}`;
}

function labelClass(isActive: boolean): string {
  return `text-[13px] ${isActive ? "text-primary-6" : "text-text-1 group-hover:text-primary-6"}`;
}

// ── SectionHeaderRow ─────────────────────────────────────────────────────────

interface SectionHeaderRowProps {
  label: string;
}

export const SectionHeaderRow: React.FC<SectionHeaderRowProps> = React.memo(
  ({ label }) => (
    <div className={`${DROPDOWN_CLASSES.sectionLabel} first:pt-1`}>{label}</div>
  )
);

SectionHeaderRow.displayName = "SectionHeaderRow";

// ── ImageRow ──────────────────────────────────────────────────────────────────

interface ImageRowProps {
  isActive: boolean;
  onMouseEnter: () => void;
  onMouseDown: () => void;
}

export const ImageRow: React.FC<ImageRowProps> = React.memo(
  ({ isActive, onMouseEnter, onMouseDown }) => {
    const { t } = useTranslation("sessions");
    return (
      <div
        data-slash-flat
        className={rowClass(isActive)}
        onMouseEnter={onMouseEnter}
        onMouseDown={(e) => {
          e.preventDefault();
          onMouseDown();
        }}
      >
        <ImageIcon
          size={14}
          strokeWidth={1.75}
          className={iconClass(isActive)}
        />
        <span className={labelClass(isActive)}>
          {t("creator.slashMenu.image", { defaultValue: "Image" })}
        </span>
      </div>
    );
  }
);

ImageRow.displayName = "ImageRow";

// ── ModeRow ───────────────────────────────────────────────────────────────────

interface ModeRowProps {
  mode: AgentExecModeEntry;
  isActive: boolean;
  isCurrent: boolean;
  onMouseEnter: () => void;
  onMouseDown: () => void;
}

export const ModeRow: React.FC<ModeRowProps> = React.memo(
  ({ mode, isActive, isCurrent, onMouseEnter, onMouseDown }) => {
    const { t } = useTranslation("sessions");
    const ModeIcon = mode.icon;
    return (
      <div
        data-slash-flat
        className={`${rowClass(isActive)} justify-between`}
        onMouseEnter={onMouseEnter}
        onMouseDown={(e) => {
          e.preventDefault();
          onMouseDown();
        }}
      >
        <div className="flex items-center gap-2">
          <ModeIcon
            size={14}
            strokeWidth={1.75}
            className={iconClass(isActive)}
          />
          <span className={labelClass(isActive)}>{t(mode.i18nKey)}</span>
        </div>
        {isCurrent && <DropdownSelectedCheck />}
      </div>
    );
  }
);

ModeRow.displayName = "ModeRow";

// ── FlyoutTriggerRow ──────────────────────────────────────────────────────────

interface FlyoutTriggerRowProps {
  category: SlashItemCategory;
  label: string;
  isActive: boolean;
  isOpen: boolean;
  onMouseEnter: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export const FlyoutTriggerRow: React.FC<FlyoutTriggerRowProps> = React.memo(
  ({ category, label, isActive, isOpen, onMouseEnter, onMouseDown }) => {
    const active = isActive || isOpen;
    return (
      <div
        data-slash-flat
        className={`${rowClass(active)} justify-between`}
        onMouseEnter={onMouseEnter}
        onMouseDown={(e) => {
          e.preventDefault();
          onMouseDown(e);
        }}
      >
        <div className="flex items-center gap-2">
          {React.createElement(categoryIcon(category), {
            size: 14,
            strokeWidth: 1.75,
            className: iconClass(active),
          })}
          <span className={labelClass(active)}>{label}</span>
        </div>
        <ChevronRight
          size={13}
          strokeWidth={1.75}
          className={active ? "text-primary-6" : "text-text-3"}
        />
      </div>
    );
  }
);

FlyoutTriggerRow.displayName = "FlyoutTriggerRow";

// ── SlashItemRow ──────────────────────────────────────────────────────────────

interface SlashItemRowProps {
  item: SlashItem;
  isActive: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}

export const SlashItemRow: React.FC<SlashItemRowProps> = React.memo(
  ({ item, isActive, onMouseEnter, onClick }) => {
    const Icon = categoryIcon(item.category);
    const description =
      item.category === "tool" && item.serverName ? item.serverName : undefined;
    return (
      <div
        data-slash-flat
        data-testid="slash-command-item"
        data-slash-category={item.category}
        data-slash-name={item.name}
      >
        <MenuItemRow
          icon={Icon}
          label={item.name}
          description={description}
          isActive={isActive}
          onClick={onClick}
          onMouseEnter={onMouseEnter}
        />
      </div>
    );
  }
);

SlashItemRow.displayName = "SlashItemRow";

// ── DividerRow ────────────────────────────────────────────────────────────────

export const DividerRow: React.FC = () => (
  <div className="mx-2 my-1 h-px bg-border-1" />
);

DividerRow.displayName = "DividerRow";

// ── ModeFlyoutTriggerRow ──────────────────────────────────────────────────────

interface ModeFlyoutTriggerRowProps {
  isActive: boolean;
  isOpen: boolean;
  currentModeName: string;
  onMouseEnter: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export const ModeFlyoutTriggerRow: React.FC<ModeFlyoutTriggerRowProps> =
  React.memo(
    ({ isActive, isOpen, currentModeName, onMouseEnter, onMouseDown }) => {
      const active = isActive || isOpen;
      const { t } = useTranslation("sessions");
      return (
        <div
          data-slash-flat
          className={`${rowClass(active)} justify-between`}
          onMouseEnter={onMouseEnter}
          onMouseDown={(e) => {
            e.preventDefault();
            onMouseDown(e);
          }}
        >
          <div className="flex items-center gap-2">
            {React.createElement(ModeIconComponent, {
              size: 14,
              strokeWidth: 1.75,
              className: iconClass(active),
            })}
            <span className={labelClass(active)}>
              {t("creator.slashMenu.mode", { defaultValue: "Mode" })}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-text-3">{currentModeName}</span>
            <ChevronRight
              size={13}
              strokeWidth={1.75}
              className={active ? "text-primary-6" : "text-text-3"}
            />
          </div>
        </div>
      );
    }
  );

ModeFlyoutTriggerRow.displayName = "ModeFlyoutTriggerRow";

// ── ModelsFlyoutTriggerRow ────────────────────────────────────────────────────

interface ModelsFlyoutTriggerRowProps {
  isActive: boolean;
  isOpen: boolean;
  currentModelName: string;
  onMouseEnter: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export const ModelsFlyoutTriggerRow: React.FC<ModelsFlyoutTriggerRowProps> =
  React.memo(
    ({ isActive, isOpen, currentModelName, onMouseEnter, onMouseDown }) => {
      const active = isActive || isOpen;
      const { t } = useTranslation("sessions");
      return (
        <div
          data-slash-flat
          className={`${rowClass(active)} justify-between`}
          onMouseEnter={onMouseEnter}
          onMouseDown={(e) => {
            e.preventDefault();
            onMouseDown(e);
          }}
        >
          <div className="flex items-center gap-2">
            {React.createElement(ModelsIconComponent, {
              size: 14,
              strokeWidth: 1.75,
              className: iconClass(active),
            })}
            <span className={labelClass(active)}>
              {t("creator.slashMenu.models", { defaultValue: "Models" })}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="shrink-0 truncate text-[12px] text-text-3"
              style={{ maxWidth: 100 }}
            >
              {currentModelName}
            </span>
            <ChevronRight
              size={13}
              strokeWidth={1.75}
              className={active ? "text-primary-6" : "text-text-3"}
            />
          </div>
        </div>
      );
    }
  );

ModelsFlyoutTriggerRow.displayName = "ModelsFlyoutTriggerRow";

// ── Re-export AgentExecMode for callers that need it ──────────────────────────

export type { AgentExecMode };
