/**
 * Primary sidebar width tokens for Workstation (My Station) and Agent Station simulator UIs.
 * Single source of truth — must match clamp logic in workStation left panel persistence.
 */
export const WORK_STATION_PRIMARY_SIDEBAR = {
  defaultWidth: 240,
  minWidth: 200,
  maxWidth: 500,
} as const;
