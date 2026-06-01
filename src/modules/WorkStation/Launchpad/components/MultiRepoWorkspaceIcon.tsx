/**
 * MultiRepoWorkspaceIcon
 *
 * Custom SVG glyph for a "multi-repo workspace" — visually distinct from
 * the single-repo `<Code />` icon used for individual repos. Renders as a
 * pair of overlapping code-bracket fragments, suggesting "multiple repos
 * bundled into one workspace". Matches Lucide's stroke conventions
 * (currentColor, configurable size + strokeWidth) so it composes with the
 * other 14px tree-row icons.
 */
import React, { memo } from "react";

interface MultiRepoWorkspaceIconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

const MultiRepoWorkspaceIcon: React.FC<MultiRepoWorkspaceIconProps> = memo(
  ({ size = 14, strokeWidth = 1.75, className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Back layer: offset code brackets */}
      <path d="m9 4 -5 5 5 5" opacity="0.55" />
      <path d="m17 4 5 5 -5 5" opacity="0.55" />
      {/* Front layer: primary code brackets, shifted down/right */}
      <path d="m7 10 -4 4 4 4" />
      <path d="m15 10 4 4 -4 4" />
      <path d="m13 8 -4 12" />
    </svg>
  )
);

MultiRepoWorkspaceIcon.displayName = "MultiRepoWorkspaceIcon";

export default MultiRepoWorkspaceIcon;
