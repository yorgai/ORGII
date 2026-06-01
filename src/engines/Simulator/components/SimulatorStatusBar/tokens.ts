import { SURFACE_TOKENS } from "@src/config/surfaceTokens";

/** 20px-tall text row — matches h-5 icon controls inside the h-8 pill. */
export const STATUS_BAR_TEXT_20 =
  "inline-flex h-5 shrink-0 items-center text-xs leading-none";

/**
 * Shared 20×20 icon button used across replay controls (Prev, Play/Pause,
 * Next, Follow). All neighbors render as a bare `<button>` with identical
 * geometry — same height, no border — so switching between states never
 * nudges the layout by a pixel. The previous implementation used the
 * generic `<Button>` component for Play/Pause, which adds a 1px border in
 * the `default` variant and omits it in `primary`, producing a subtle
 * ~1px row shift when toggling playing/paused.
 *
 * `transform-gpu` promotes each button to its own compositor layer so that
 * frequent re-renders during slider drag (which re-runs reconciliation on
 * every event-index change) never trigger sub-pixel rasterization shifts
 * on neighboring icons. `transition-colors` is intentionally omitted —
 * the cost of an instant color swap on hover is invisible, but keeping it
 * causes the SVG icons to "shake" during high-frequency parent updates.
 *
 * All buttons are `rounded-full` so they read as little pills inside the
 * outer pill — visually consistent with the chat composer's icon row.
 */
export const STATUS_BAR_ICON_BTN_20 = `flex h-5 w-5 transform-gpu items-center justify-center rounded-full text-text-2 ${SURFACE_TOKENS.hover} hover:text-primary-6 disabled:cursor-not-allowed disabled:opacity-40`;

/** Circular filled-neutral variant — Pause button while replay is playing. */
export const STATUS_BAR_ICON_BTN_20_CIRCLE_NEUTRAL =
  "flex h-5 w-5 transform-gpu items-center justify-center rounded-full bg-fill-3 text-text-1 hover:bg-fill-4 hover:text-primary-6 disabled:cursor-not-allowed disabled:opacity-40";

/** Circular filled-primary variant — Play button while replay is paused. */
export const STATUS_BAR_ICON_BTN_20_CIRCLE_PRIMARY =
  "flex h-5 w-5 transform-gpu items-center justify-center rounded-full bg-primary-6 text-white hover:bg-primary-5 disabled:cursor-not-allowed disabled:opacity-40";
