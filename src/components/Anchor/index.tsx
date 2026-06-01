/**
 * Anchor Component
 *
 * A vertical navigation component for scrolling to sections within a container.
 * Displays a list of links that scroll to corresponding sections when clicked.
 *
 * @example
 * ```tsx
 * import Anchor from "@src/components/Anchor";
 *
 * const items = [
 *   { key: "section1", label: "Section 1", count: 5 },
 *   { key: "section2", label: "Section 2", count: 12 },
 * ];
 *
 * <div className="flex">
 *   <Anchor
 *     items={items}
 *     activeKey={activeKey}
 *     onSelect={(key) => scrollToSection(key)}
 *   />
 *   <div className="flex-1">
 *     <section id="section1">...</section>
 *     <section id="section2">...</section>
 *   </div>
 * </div>
 * ```
 */
import React, { memo, useCallback } from "react";

// ============================================
// Types
// ============================================

export interface AnchorItem {
  /** Unique key for the anchor item */
  key: string;
  /** Display label */
  label: string;
  /** Optional count to display */
  count?: number;
}

export interface AnchorProps {
  /** List of anchor items */
  items: AnchorItem[];
  /** Currently active key */
  activeKey?: string | null;
  /** Callback when an anchor is clicked */
  onSelect?: (key: string) => void;
  /** Additional CSS classes for the container */
  className?: string;
}

// ============================================
// Component
// ============================================

export const Anchor: React.FC<AnchorProps> = memo(
  ({ items, activeKey, onSelect, className = "" }) => {
    const handleClick = useCallback(
      (key: string) => {
        onSelect?.(key);
      },
      [onSelect]
    );

    return (
      <nav className={`flex flex-col gap-0.5 ${className}`}>
        {items.map((item) => {
          const isActive = item.key === activeKey;

          return (
            <button
              key={item.key}
              onClick={() => handleClick(item.key)}
              className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                isActive
                  ? "bg-primary-1 font-medium text-primary-6"
                  : "text-text-2 hover:bg-fill-1 hover:text-text-1"
              }`}
            >
              <span className="truncate capitalize">{item.label}</span>
              {item.count !== undefined && (
                <span
                  className={`ml-2 shrink-0 text-[10px] tabular-nums ${
                    isActive ? "text-primary-5" : "text-text-4"
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    );
  }
);

Anchor.displayName = "Anchor";

export default Anchor;
