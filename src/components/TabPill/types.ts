import type { ReactNode } from "react";

import type { GlassRegion } from "@src/util/ui/theme/glassMaterial";

export interface TabPillItem {
  key: string;
  label: string;
  icon?: ReactNode;
  hoverIcon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  dropdown?: ReactNode;
  dataTestId?: string;
}

export interface TabPillProps {
  tabs: (TabPillItem | string)[];
  activeTab?: string;
  defaultActiveTab?: string;
  onChange?: (key: string) => void;
  activeTabs?: string[];
  onMultiChange?: (keys: string[]) => void;
  variant?: "sidebar" | "pill" | "simple";
  color?: "default" | "fill";
  className?: string;
  iconOnly?: boolean;
  region?: GlassRegion;
  fillWidth?: boolean;
  wrap?: boolean;
  size?: "mini" | "small" | "default" | "large";
  /**
   * - `default` / `muted` / `layout` — opaque pill backgrounds tuned for sidebars and filter chips.
   * - `ghost` — transparent inactive, `surface-hover` on hover, `fill-2 + primary-6` on active.
   *   Mirrors the Select `variant="ghost" size="mini"` trigger so a `<TabPill size="mini" colorScheme="ghost" />`
   *   visually matches the SettingsTable filter selects.
   */
  colorScheme?: "default" | "muted" | "layout" | "ghost";
  onDropdownRef?: (close: () => void) => void;
}
