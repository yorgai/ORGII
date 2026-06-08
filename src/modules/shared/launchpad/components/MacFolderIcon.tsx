/**
 * MacFolderIcon
 *
 * macOS Finder–style folder icon as a single inline SVG. Renders a folder
 * shape (front flap + tab) tinted with the supplied base color, plus an
 * optional centered label (1–2 characters) so it can stand in for a repo
 * "avatar" inside the Launchpad grid.
 *
 * The shading uses two stops derived from `color` to give the same
 * front-lit / shadowed-rear-tab impression as Finder folders without
 * pulling in any image assets.
 */
import React from "react";

interface MacFolderIconProps {
  /** Base tint (CSS color). Lighter/darker variants are derived from this. */
  color: string;
  /** Optional 1–2 character label drawn centered on the folder face. */
  label?: string;
  /** Rendered width / height in px. SVG itself is viewBox-based. */
  size?: number;
  /** Extra className passed to the root <svg>. */
  className?: string;
}

function colorMix(color: string, amount: number): string {
  const target = amount >= 0 ? "white" : "black";
  return `color-mix(in srgb, ${color} ${Math.round((1 - Math.abs(amount)) * 100)}%, ${target})`;
}

function withAlpha(color: string, alpha: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}

const MacFolderIcon: React.FC<MacFolderIconProps> = ({
  color,
  label,
  size = 56,
  className,
}) => {
  const tabColor = colorMix(color, -0.18);
  const faceTop = colorMix(color, 0.12);
  const faceBottom = colorMix(color, -0.08);
  const highlight = withAlpha(colorMix(color, 0.45), 0.35);
  const innerShadow = withAlpha(colorMix(color, -0.35), 0.35);

  // Deterministic-ish unique gradient ids so multiple icons can coexist
  // without colliding on a single document-wide id.
  const uid = React.useId();
  const faceGradId = `mac-folder-face-${uid}`;
  const tabGradId = `mac-folder-tab-${uid}`;
  const highlightGradId = `mac-folder-highlight-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      role="img"
      aria-label={label ? `Folder ${label}` : "Folder"}
      className={className}
    >
      <defs>
        <linearGradient id={faceGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={faceTop} />
          <stop offset="100%" stopColor={faceBottom} />
        </linearGradient>
        <linearGradient id={tabGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colorMix(color, -0.05)} />
          <stop offset="100%" stopColor={tabColor} />
        </linearGradient>
        <linearGradient id={highlightGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={highlight} />
          <stop offset="55%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>

      {/* Back tab (the small protruding section on top). */}
      <path
        d="M8 14
           Q8 11 11 11
           H22
           Q24 11 25.4 12.6
           L27.6 15.2
           Q29 16.8 31 16.8
           H45
           Q48 16.8 48 19.8
           V22
           H8
           Z"
        fill={`url(#${tabGradId})`}
      />

      {/* Front face of the folder. */}
      <path
        d="M6 22
           Q6 18.5 9.5 18.5
           H46.5
           Q50 18.5 50 22
           V42
           Q50 46 46 46
           H10
           Q6 46 6 42
           Z"
        fill={`url(#${faceGradId})`}
      />

      {/* Top inner shadow line between tab and face. */}
      <path
        d="M6 22 H50"
        stroke={innerShadow}
        strokeWidth="0.6"
        fill="none"
        opacity="0.55"
      />

      {/* Subtle top-edge highlight on the front face. */}
      <path
        d="M6 22
           Q6 18.5 9.5 18.5
           H46.5
           Q50 18.5 50 22
           V25
           H6
           Z"
        fill={`url(#${highlightGradId})`}
      />

      {/* Optional letter label. */}
      {label ? (
        <text
          x="28"
          y="38"
          textAnchor="middle"
          fontSize="16"
          fontWeight="600"
          fill="rgba(255,255,255,0.92)"
          style={{
            paintOrder: "stroke",
          }}
        >
          {label}
        </text>
      ) : null}
    </svg>
  );
};

export default React.memo(MacFolderIcon);
