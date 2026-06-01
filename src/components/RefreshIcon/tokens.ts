/**
 * Refresh Icon Tokens
 *
 * Centralized class names for RefreshCw spin animations.
 * CSS definitions live in src/styles/_utilities.scss.
 * Duration: 1.2s per 2 rounds (720deg).
 *
 * Usage:
 * ```tsx
 * import { REFRESH_ICON_TOKENS } from "@src/components/RefreshIcon/tokens";
 *
 * <RefreshCw className={loading ? REFRESH_ICON_TOKENS.spin : ""} />
 * <RefreshCw className={isSpinning ? REFRESH_ICON_TOKENS.oneShot : ""} />
 * ```
 */
export const REFRESH_ICON_TOKENS = {
  /** Refresh button hover treatment */
  button: "btn-refresh",
  /** Continuous 2-round spin while class is present */
  spin: "refresh-spinning",
  /** One-shot 2-round spin (apply on trigger, auto-stops) */
  oneShot: "btn-refresh-spin",
} as const;
