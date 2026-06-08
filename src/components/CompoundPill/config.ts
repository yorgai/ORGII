/**
 * CompoundPill Config
 *
 * Shared sizing constants for pill components (CompoundPill + SelectorPill sm/md).
 * Single source of truth for the standard small-pill size token.
 */

/** Icon size for standard pill segments (sm / md SelectorPill, CompoundPill) */
export const PILL_SM_ICON_SIZE = 14;

/** Icon container class — 16×16 line box with a 14px SVG for centered pill text. */
export const PILL_SM_ICON_CONTAINER_CLASS =
  "relative inline-flex h-[16px] w-[16px] items-center justify-center";

/** Pill height token used by CompoundPill and SelectorPill sm/md variants */
export const PILL_SM_HEIGHT_CLASS = "h-[28px]";

/** Label line-height that visually centers 12–13px text in 28px pills. */
export const PILL_SM_LABEL_CLASS = "leading-[16px]";

/** @deprecated Use PILL_SM_ICON_SIZE directly */
export function getIconSize(): number {
  return PILL_SM_ICON_SIZE;
}
