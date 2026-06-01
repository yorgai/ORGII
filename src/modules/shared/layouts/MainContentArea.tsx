/**
 * Main Content Area Shared Component
 *
 * Reusable wrapper for main content area across all layouts
 *
 * Optimizations:
 * - Uses CSS containment for layout isolation (prevents reflows propagating)
 * - Stable structure prevents DOM thrashing during route changes
 */
import React, { memo } from "react";

interface MainContentAreaProps {
  children: React.ReactNode;
  className?: string;
}

const MainContentAreaComponent: React.FC<MainContentAreaProps> = ({
  children,
  className = "",
}) => {
  return (
    <div
      className={`flex h-full flex-1 flex-col ${className}`}
      style={{
        // Containment helps prevent layout thrashing during page transitions
        contain: "layout style",
      }}
    >
      {children}
    </div>
  );
};

MainContentAreaComponent.displayName = "MainContentArea";

export const MainContentArea = memo(MainContentAreaComponent);
