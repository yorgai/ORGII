import type React from "react";

import type {
  AgentExecMode,
  AgentExecModeEntry,
} from "@src/config/sessionCreatorConfig";
import type { SlashItem, SlashItemCategory } from "@src/types/extensions";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Input source for filtering the / menu.
 * - "inline": filter text comes from the editor (user typed `/` then a query).
 * - "header": dropdown owns a search input; used when opened via button click.
 */
export type SlashCommandSearchMode = "inline" | "header";

export interface SlashCommandPortalProps {
  visible: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  items: SlashItem[];
  loading: boolean;
  currentMode: AgentExecMode;
  /** Pre-filtered query (slash items already filtered upstream). */
  searchQuery?: string;
  onClose: () => void;
  onSelect: (item: SlashItem) => void;
  onModeSelect: (mode: AgentExecMode) => void;
  keyboardHandlerRef: React.MutableRefObject<
    ((e: KeyboardEvent) => boolean) | null
  >;
  /** Defaults to "inline". */
  searchMode?: SlashCommandSearchMode;
  /** Header-mode only: called when the in-dropdown input changes. */
  onSearchQueryChange?: (query: string) => void;
  /**
   * When true (default for the + button menu), shows Mode flyout trigger
   * and Models flyout trigger. When false (inline / search mode), these are
   * hidden because they are already accessible via the toolbar pills.
   */
  showActionFlyouts?: boolean;
  /** When provided, renders an Image upload row. */
  onImageUpload?: () => void;
}

// ── Internal list-entry union ─────────────────────────────────────────────────

export interface ModeEntry {
  kind: "mode";
  mode: AgentExecModeEntry;
  flatIndex: number;
}

export interface SlashEntry {
  kind: "item";
  item: SlashItem;
  flatIndex: number;
}

export interface SectionHeader {
  kind: "header";
  label: string;
}

/** Trigger row that opens a flyout submenu (for SlashItem categories). */
export interface FlyoutEntry {
  kind: "flyout";
  category: SlashItemCategory;
  label: string;
  items: SlashItem[];
  flatIndex: number;
}

/** Trigger row for the Mode flyout (lists all exec modes). */
export interface ModeFlyoutEntry {
  kind: "mode-flyout";
  flatIndex: number;
}

/** Trigger row for the Models flyout (opens model picker). */
export interface ModelsFlyoutEntry {
  kind: "models-flyout";
  flatIndex: number;
}

/** Image upload shortcut row. */
export interface ImageEntry {
  kind: "image";
  flatIndex: number;
}

/** Visual separator between sections. */
export interface DividerEntry {
  kind: "divider";
}

export type ListEntry =
  | ModeEntry
  | SlashEntry
  | SectionHeader
  | FlyoutEntry
  | ModeFlyoutEntry
  | ModelsFlyoutEntry
  | ImageEntry
  | DividerEntry;

// ── Open-flyout state ─────────────────────────────────────────────────────────

export type FlyoutKind = "category" | "modes" | "models";

export interface OpenFlyoutState {
  kind: FlyoutKind;
  anchorTop: number;
  /** Only set when kind === "category" */
  category?: SlashItemCategory;
  /** Only set when kind === "category" */
  items?: SlashItem[];
}
