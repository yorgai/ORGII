/**
 * PropertySection Component
 *
 * Collapsible section for property panels (Design, CSS, etc.)
 * Simpler than PrimarySidebarLayout/CollapsibleSection - no resize handles.
 *
 * Used by: WebDevTools DesignPanel, DesignerInspector
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import React, { memo, useCallback, useState } from "react";

// ============================================
// Types
// ============================================

export interface PropertySectionProps {
  /** Section title */
  title: string;
  /** Optional right-side content (e.g., value badge) */
  rightContent?: React.ReactNode;
  /** Header action buttons */
  headerActions?: React.ReactNode;
  /** Section content */
  children: React.ReactNode;
  /** Whether section starts expanded */
  defaultExpanded?: boolean;
  /** Force all sections to collapse (increments to trigger) */
  collapseAllKey?: number;
  /** Force all sections to expand (increments to trigger) */
  expandAllKey?: number;
}

export interface SubSectionProps {
  /** Subsection title */
  title: string;
  /** Header action buttons (e.g., link toggle) */
  headerActions?: React.ReactNode;
  /** Section content */
  children: React.ReactNode;
}

// ============================================
// SubSection Component (smaller inline header)
// ============================================

export const SubSection: React.FC<SubSectionProps> = memo(
  ({ title, headerActions, children }) => {
    return (
      <div className="mb-2 last:mb-0">
        <div className="mb-1.5 flex items-center justify-between pr-1">
          <span className="text-[12px] text-text-1">{title}</span>
          {headerActions && (
            <div className="flex items-center">{headerActions}</div>
          )}
        </div>
        {children}
      </div>
    );
  }
);

SubSection.displayName = "SubSection";

// ============================================
// PropertySection Component
// ============================================

export const PropertySection: React.FC<PropertySectionProps> = memo(
  ({
    title,
    rightContent,
    headerActions,
    children,
    defaultExpanded = true,
    collapseAllKey,
    expandAllKey,
  }) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const [prevCollapseKey, setPrevCollapseKey] = useState(collapseAllKey);
    const [prevExpandKey, setPrevExpandKey] = useState(expandAllKey);

    // Update expanded state when keys change (React recommended pattern - setState during render)
    if (collapseAllKey !== undefined && collapseAllKey !== prevCollapseKey) {
      setPrevCollapseKey(collapseAllKey);
      setIsExpanded(false);
    }
    if (expandAllKey !== undefined && expandAllKey !== prevExpandKey) {
      setPrevExpandKey(expandAllKey);
      setIsExpanded(true);
    }

    const handleToggle = useCallback(() => {
      setIsExpanded((prev) => !prev);
    }, []);

    return (
      <div className="mb-1">
        {/* Header */}
        <div className="flex items-center gap-1.5 py-1.5">
          <button
            onClick={handleToggle}
            className="flex flex-1 items-center gap-1.5 text-left"
          >
            {isExpanded ? (
              <ChevronDown size={14} className="flex-shrink-0 text-text-3" />
            ) : (
              <ChevronRight size={14} className="flex-shrink-0 text-text-3" />
            )}
            <span className="flex-1 text-[12px] font-medium uppercase text-text-2">
              {title}
            </span>
            {rightContent && (
              <span className="text-[11px] text-text-3">{rightContent}</span>
            )}
          </button>
          {headerActions && (
            <div className="flex items-center">{headerActions}</div>
          )}
        </div>

        {/* Content */}
        {isExpanded && <div className="pb-3 pt-1">{children}</div>}
      </div>
    );
  }
);

PropertySection.displayName = "PropertySection";

export default PropertySection;
