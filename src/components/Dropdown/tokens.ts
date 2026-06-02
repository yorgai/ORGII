/**
 * Dropdown Design Tokens
 *
 * Centralized design tokens for all dropdown/select components.
 * Use these tokens to ensure consistent styling across:
 * - Select
 * - Dropdown
 * - Menu
 * - DropdownPill
 * - ContextMenu
 * - etc.
 */

// ==============================================
// Panel Tokens (dropdown container)
// ==============================================

export const DROPDOWN_PANEL = {
  /** Border radius for dropdown panels */
  borderRadius: 8,
  borderRadiusClass: "rounded-lg",

  /** Box shadow - light mode */
  shadow: "0 4px 16px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.08)",
  shadowClass: "shadow-dropdown",

  /** Box shadow - dark mode */
  shadowDark: "0 4px 16px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.3)",

  /** z-index for dropdown panels */
  zIndex: 1050,
  zIndexClass: "z-[1050]",

  /** Panel padding (no header) */
  padding: 4,
  paddingClass: "p-1",

  /**
   * Items-container padding when the panel ALSO renders a `sectionLabel`
   * header above. The header already supplies vertical breathing room, so
   * the items wrapper drops `pt-*` and keeps only `px-1 pb-1` to avoid the
   * doubled gap between header text and the first item.
   */
  paddingBelowHeaderClass: "px-1 pb-1",

  /** Max height for the panel itself */
  maxHeight: 256,
  maxHeightClass: "max-h-64",

  /** Max height for scrollable options inside a panel with search/header.
   *  Shorter than maxHeight so scroll triggers before outer overflow-hidden clips. */
  optionsMaxHeight: 200,
  optionsMaxHeightClass: "max-h-[200px]",

  /** Gap between trigger and dropdown (px). Default for useDropdownEngine. */
  triggerGap: 8,
  /** Compact gap for tight UIs (sidebar tab list, inline menus) */
  triggerGapCompact: 4,

  /** Gap between dropdown items (px). gap-0.5 = 2px. */
  itemsGap: 2,
  itemsGapClass: "gap-0.5",

  /** Animation duration */
  animationDuration: "0.2s",

  /** Background and border (use Tailwind classes) */
  bgClass: "bg-bg-2",
  borderClass: "border border-solid border-border-2",
} as const;

// ==============================================
// Item Tokens (menu items/options)
// ==============================================

export const DROPDOWN_ITEM = {
  /** Border radius for items */
  borderRadius: 6,
  borderRadiusClass: "rounded-md",

  /**
   * Horizontal padding. Tightened from px-3 to px-1.5 so dropdown rows
   * feel "compact" — the row's hover/selected pill hugs the label
   * instead of bleeding out to the panel edges. Affects every variant
   * built on this token (`item`, `itemCompact`, sectioned items, etc.).
   */
  paddingX: 6,
  paddingXClass: "px-1.5",

  /** Vertical padding */
  paddingY: 8,
  paddingYClass: "py-2",

  /** Gap between icon and label */
  gap: 8,
  gapClass: "gap-2",

  /** Font size */
  fontSize: 14,
  fontSizeClass: "text-sm",

  /** Hover background */
  hoverBgClass: "hover:bg-surface-hover",

  /**
   * Selected background — intentionally transparent. The selected state is
   * communicated by a checkmark and primary-6 text only; keyboard hover is
   * the only filled state in dropdowns.
   */
  selectedBgClass: "bg-transparent",

  /** Selected text color */
  selectedTextClass: "!text-primary-6",

  /** Disabled opacity */
  disabledOpacity: 0.5,
  disabledClass: "opacity-50 cursor-not-allowed",

  /** Transition */
  transitionClass: "transition-colors duration-150",
} as const;

// ==============================================
// Search Input Tokens
// ==============================================

export const DROPDOWN_SEARCH = {
  /** Height */
  height: 32,
  heightClass: "h-8",

  /** Padding */
  paddingX: 12,
  paddingXClass: "px-3",

  /** Border radius */
  borderRadius: 6,
  borderRadiusClass: "rounded-md",

  /** Font size */
  fontSize: 14,
  fontSizeClass: "text-sm",

  /** Icon size */
  iconSize: 14,
} as const;

// ==============================================
// Composite Class Strings (for easy use)
// ==============================================

/**
 * Complete class string for dropdown panel container
 * Usage: <div className={DROPDOWN_CLASSES.panel}>...</div>
 */
export const DROPDOWN_CLASSES = {
  /** Panel container classes */
  panel: [
    DROPDOWN_PANEL.bgClass,
    DROPDOWN_PANEL.borderClass,
    DROPDOWN_PANEL.borderRadiusClass,
    DROPDOWN_PANEL.zIndexClass,
    "shadow-dropdown",
    "overflow-hidden",
  ].join(" "),

  /** Panel with animation */
  panelAnimated: [
    DROPDOWN_PANEL.bgClass,
    DROPDOWN_PANEL.borderClass,
    DROPDOWN_PANEL.borderRadiusClass,
    DROPDOWN_PANEL.zIndexClass,
    "shadow-dropdown",
    "overflow-hidden",
    "animate-dropdown-in",
  ].join(" "),

  /** Scrollable options container (scrollbar hidden) */
  optionsContainer: [
    "flex flex-col",
    "cursor-default",
    DROPDOWN_PANEL.itemsGapClass,
    DROPDOWN_PANEL.paddingClass,
    DROPDOWN_PANEL.maxHeightClass,
    "overflow-y-auto",
    "scrollbar-hide",
  ].join(" "),

  /** Scrollable options container when a `sectionLabel` header sits above. */
  optionsContainerBelowHeader: [
    "flex flex-col",
    "cursor-default",
    DROPDOWN_PANEL.itemsGapClass,
    DROPDOWN_PANEL.paddingBelowHeaderClass,
    DROPDOWN_PANEL.maxHeightClass,
    "overflow-y-auto",
    "scrollbar-hide",
  ].join(" "),

  /** Scrollable options container (visible scrollbar, e.g. table selector, timezone) */
  optionsContainerScrollbar: [
    "flex flex-col",
    "cursor-default",
    DROPDOWN_PANEL.itemsGapClass,
    DROPDOWN_PANEL.paddingClass,
    DROPDOWN_PANEL.maxHeightClass,
    "overflow-y-auto",
    "dropdown-options-scrollbar",
  ].join(" "),

  /** Scrollable options container (visible scrollbar) when a header sits above. */
  optionsContainerScrollbarBelowHeader: [
    "flex flex-col",
    "cursor-default",
    DROPDOWN_PANEL.itemsGapClass,
    DROPDOWN_PANEL.paddingBelowHeaderClass,
    DROPDOWN_PANEL.maxHeightClass,
    "overflow-y-auto",
    "dropdown-options-scrollbar",
  ].join(" "),

  /** Item base classes */
  item: [
    "flex",
    "items-center",
    DROPDOWN_ITEM.gapClass,
    DROPDOWN_ITEM.paddingXClass,
    DROPDOWN_ITEM.paddingYClass,
    DROPDOWN_ITEM.borderRadiusClass,
    DROPDOWN_ITEM.fontSizeClass,
    DROPDOWN_ITEM.transitionClass,
    "cursor-pointer",
    "text-text-1",
  ].join(" "),

  /** Item compact variant (py-1.5 instead of py-2) - for dense lists like file browsers */
  itemCompact: [
    "flex",
    "items-center",
    DROPDOWN_ITEM.gapClass,
    DROPDOWN_ITEM.paddingXClass,
    "py-1.5",
    DROPDOWN_ITEM.borderRadiusClass,
    "text-[13px]",
    DROPDOWN_ITEM.transitionClass,
    "cursor-pointer",
    "text-text-1",
  ].join(" "),

  /** Item hover state */
  itemHover: DROPDOWN_ITEM.hoverBgClass,

  /** Item selected state */
  itemSelected: [
    DROPDOWN_ITEM.selectedBgClass,
    DROPDOWN_ITEM.selectedTextClass,
    "[&_svg]:text-primary-6",
    "hover:bg-surface-hover",
    "hover:!text-primary-6",
    "font-medium",
  ].join(" "),

  /** Item disabled state */
  itemDisabled: DROPDOWN_ITEM.disabledClass,

  /** Compact menu panel that sizes to its single-line action content. */
  menuPanelCompact: [
    DROPDOWN_PANEL.bgClass,
    DROPDOWN_PANEL.borderClass,
    DROPDOWN_PANEL.borderRadiusClass,
    DROPDOWN_PANEL.shadowClass,
    DROPDOWN_PANEL.paddingClass,
    DROPDOWN_PANEL.zIndexClass,
    "min-w-[140px]",
    "w-max",
  ].join(" "),

  /** Compact menu panel with a full-width header/search row. */
  menuPanelCompactWithHeader: [
    DROPDOWN_PANEL.bgClass,
    DROPDOWN_PANEL.borderClass,
    DROPDOWN_PANEL.borderRadiusClass,
    DROPDOWN_PANEL.shadowClass,
    DROPDOWN_PANEL.zIndexClass,
    "min-w-[140px]",
    "w-max",
    "overflow-hidden",
  ].join(" "),

  /** Full-width compact menu item that keeps labels on one line. */
  menuActionItemCompact: [
    "flex",
    "w-full",
    "items-center",
    "justify-start",
    "whitespace-nowrap",
    "text-left",
    DROPDOWN_ITEM.gapClass,
    DROPDOWN_ITEM.paddingXClass,
    "py-1.5",
    DROPDOWN_ITEM.borderRadiusClass,
    "text-[13px]",
    DROPDOWN_ITEM.transitionClass,
    "cursor-pointer",
    "text-text-1",
    DROPDOWN_ITEM.hoverBgClass,
  ].join(" "),

  /** Compact menu row for label + right-side control such as Switch. */
  menuControlItemCompact: [
    "flex",
    "w-full",
    "items-center",
    "justify-between",
    "whitespace-nowrap",
    "text-left",
    DROPDOWN_ITEM.gapClass,
    DROPDOWN_ITEM.paddingXClass,
    "py-1.5",
    DROPDOWN_ITEM.borderRadiusClass,
    "text-[13px]",
    DROPDOWN_ITEM.transitionClass,
    "text-text-1",
    DROPDOWN_ITEM.hoverBgClass,
  ].join(" "),

  /** Separator between compact menu groups. */
  menuSeparator: ["my-1", "border-t", "border-solid", "border-border-2"].join(
    " "
  ),

  /** Search input container */
  searchContainer: [
    "flex",
    "shrink-0",
    "items-center",
    "gap-2",
    "px-3",
    "py-2",
    "border-b",
    "border-solid",
    "border-border-2",
  ].join(" "),

  /** Compact search input container for dense menu palettes. */
  searchContainerCompact: [
    "flex",
    "shrink-0",
    "items-center",
    "gap-2",
    "px-3",
    "py-1.5",
    "border-b",
    "border-solid",
    "border-border-2",
  ].join(" "),

  /** Search input */
  searchInput: [
    "flex-1",
    "bg-transparent",
    "border-none",
    "outline-none",
    DROPDOWN_SEARCH.fontSizeClass,
    "text-text-1",
    "placeholder:text-text-3",
  ].join(" "),

  /** Compact search input for dense menu palettes. */
  searchInputCompact: [
    "flex-1",
    "bg-transparent",
    "border-none",
    "outline-none",
    "text-[13px]",
    "text-text-1",
    "placeholder:text-text-3",
  ].join(" "),

  /** Column wrapper for dropdown items (flex + items gap). Use when stacking items without optionsContainer. */
  itemsColumn: ["flex flex-col", DROPDOWN_PANEL.itemsGapClass].join(" "),

  /**
   * Column wrapper + padding for items rendered directly under a
   * `sectionLabel` header — drops top padding so the gap between header
   * and first item matches the visual spec.
   */
  itemsColumnBelowHeader: [
    "flex flex-col",
    DROPDOWN_PANEL.itemsGapClass,
    DROPDOWN_PANEL.paddingBelowHeaderClass,
  ].join(" "),

  /** Compact item column directly under a full-width search/header row. */
  itemsColumnCompactBelowSearch: [
    "flex flex-col",
    DROPDOWN_PANEL.itemsGapClass,
    DROPDOWN_PANEL.paddingClass,
  ].join(" "),

  /** Section / group label inside a dropdown (non-interactive). */
  sectionLabel: "py-2 pl-2.5 pr-2 text-[12px] font-medium text-text-3",

  /** Footer container (Select All, actions) — flex, border-t, p-1 */
  footerContainer: [
    "flex",
    "shrink-0",
    "items-center",
    "gap-2",
    "border-t",
    "border-solid",
    "border-border-2",
    DROPDOWN_PANEL.paddingClass,
  ].join(" "),
} as const;

// ==============================================
// Width Tokens
// ==============================================

export const DROPDOWN_WIDTHS = {
  /** Menu/list dropdown — channel selector, etc. */
  menuClass: "min-w-[140px]",
  /** Sidebar tab list, inline menu — Project/History switcher, etc. */
  sidebarMenuClass: "min-w-[180px]",
  /** Wide menu — status bar, model selector, trajectory */
  wideMenuClass: "min-w-[200px]",
  /** Panel dropdown — info popover, tooltip panel */
  panelWidthClass: "min-w-[220px]",
  /** File tree dropdown, multi-select panels */
  fileTreeClass: "min-w-[280px]",
} as const;

/** Minimum width (px) for multi-select dropdown panels */
export const MULTI_SELECT_PANEL_WIDTH = 280;

export const MULTI_SELECT_TOKENS = {
  /** Max tags shown before truncating to +X (keeps single line) */
  maxTagCount: 2,
  /** Select All / Unselect All button in footer */
  footerSelectAll: "text-xs text-text-2 hover:text-text-1 cursor-pointer",
} as const;

// ==============================================
// Style Objects (for inline styles when needed)
// ==============================================

export const DROPDOWN_STYLES = {
  /** Panel shadow style */
  panelShadow: {
    boxShadow: DROPDOWN_PANEL.shadow,
  },

  /** Panel shadow style (dark mode) */
  panelShadowDark: {
    boxShadow: DROPDOWN_PANEL.shadowDark,
  },

  /** Dropdown animation keyframes (for CSS-in-JS) */
  animation: {
    from: {
      opacity: 0,
      transform: "translateY(-8px)",
    },
    to: {
      opacity: 1,
      transform: "translateY(0)",
    },
  },
} as const;

// ==============================================
// Type Exports
// ==============================================

export type DropdownPanelTokens = typeof DROPDOWN_PANEL;
export type DropdownItemTokens = typeof DROPDOWN_ITEM;
export type DropdownSearchTokens = typeof DROPDOWN_SEARCH;
