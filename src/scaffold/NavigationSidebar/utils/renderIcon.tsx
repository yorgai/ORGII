/**
 * Shared renderIcon utility
 *
 * Renders a SidebarIcon (LucideIcon component or string icon name)
 * with optional favicon and loading spinner support.
 */
import type { LucideIcon } from "lucide-react";
import React from "react";

import type { SidebarIcon } from "../types";

interface RenderIconOptions {
  className?: string;
  size?: number;
  /** Favicon URL — renders an <img> instead of an icon */
  faviconUrl?: string;
  /** Show spin animation (for loading states) */
  isLoading?: boolean;
}

/**
 * Render a sidebar icon consistently across all sidebar components.
 *
 * Supports:
 * - LucideIcon components
 * - String icon names (legacy, renders <i> tag)
 * - Favicon URLs (renders <img>)
 * - Loading spinner animation
 */
export function renderSidebarIcon(
  icon: SidebarIcon | undefined,
  options: RenderIconOptions = {}
): React.ReactNode {
  const { className = "", size = 14, faviconUrl, isLoading = false } = options;

  // Favicon image
  if (faviconUrl) {
    return (
      <img
        src={faviconUrl}
        alt=""
        className={`rounded-sm ${className}`}
        style={{ width: size, height: size }}
        onError={(event) => {
          (event.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }

  if (!icon) return null;

  // Legacy string icon name
  if (typeof icon === "string") {
    return <i className={`${icon} ${className}`} style={{ fontSize: size }} />;
  }

  // Lucide icon component
  const animationClass = isLoading ? "animate-spin" : "";
  const combinedClassName = `${className} ${animationClass}`.trim();
  const IconComponent = icon as LucideIcon;

  return (
    <IconComponent size={size} strokeWidth={2} className={combinedClassName} />
  );
}
