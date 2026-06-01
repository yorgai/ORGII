/**
 * SpacingIcons
 *
 * Custom SVG icons for single-direction spacing (top, right, bottom, left).
 * Based on Lucide's AlignVerticalSpaceAround and AlignHorizontalSpaceAround,
 * showing only one edge line each.
 *
 * Original icons have:
 * - align-vertical-space-around: center rect + top line + bottom line
 * - align-horizontal-space-around: center rect + left line + right line
 *
 * These derivatives show only one edge line.
 */
import React, { memo } from "react";

interface IconProps {
  size?: number;
  className?: string;
}

/**
 * Top spacing icon - center rect with top line only
 * Based on align-vertical-space-around, bottom line removed
 */
export const SpacingTop: React.FC<IconProps> = memo(
  ({ size = 14, className }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="10" height="6" x="7" y="9" rx="2" />
      <path d="M22 4H2" />
    </svg>
  )
);

SpacingTop.displayName = "SpacingTop";

/**
 * Bottom spacing icon - center rect with bottom line only
 * Based on align-vertical-space-around, top line removed
 */
export const SpacingBottom: React.FC<IconProps> = memo(
  ({ size = 14, className }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="10" height="6" x="7" y="9" rx="2" />
      <path d="M22 20H2" />
    </svg>
  )
);

SpacingBottom.displayName = "SpacingBottom";

/**
 * Left spacing icon - center rect with left line only
 * Based on align-horizontal-space-around, right line removed
 */
export const SpacingLeft: React.FC<IconProps> = memo(
  ({ size = 14, className }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="6" height="10" x="9" y="7" rx="2" />
      <path d="M4 22V2" />
    </svg>
  )
);

SpacingLeft.displayName = "SpacingLeft";

/**
 * Right spacing icon - center rect with right line only
 * Based on align-horizontal-space-around, left line removed
 */
export const SpacingRight: React.FC<IconProps> = memo(
  ({ size = 14, className }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="6" height="10" x="9" y="7" rx="2" />
      <path d="M20 22V2" />
    </svg>
  )
);

SpacingRight.displayName = "SpacingRight";
