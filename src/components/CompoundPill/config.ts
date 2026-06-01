/**
 * CompoundPill Config
 *
 * Shared sizing constants for pill components (CompoundPill + SelectorPill sm/md).
 * Single source of truth for the standard small-pill size token.
 */

/** Icon size for standard pill segments (sm / md SelectorPill, CompoundPill) */
export const PILL_SM_ICON_SIZE = 14;

/** Icon container class — 14×14 relative container for the swap animation */
export const PILL_SM_ICON_CONTAINER_CLASS =
  "relative inline-flex h-[14px] w-[14px] items-center justify-center";

/** Pill height token used by CompoundPill and SelectorPill sm/md variants */
export const PILL_SM_HEIGHT_CLASS = "h-[28px]";

/** @deprecated Use PILL_SM_ICON_SIZE directly */
export function getIconSize(): number {
  return PILL_SM_ICON_SIZE;
}
