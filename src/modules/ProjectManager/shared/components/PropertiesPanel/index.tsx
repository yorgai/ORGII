/**
 * PropertiesPanel Component
 *
 * Reusable shell for any properties sidebar in Project Manager.
 * Provides: 40px header + scrollable padded content area.
 *
 * Usage:
 *   <PropertiesPanel title="Properties">
 *     <FieldRow ... />
 *     <FieldRow ... />
 *   </PropertiesPanel>
 *
 * Also exports ProjectPropertyFields for project-specific fields.
 */
import React, { useRef } from "react";
import { useTranslation } from "react-i18next";

import { HEADER_CLASSES } from "@src/config/workstation/tokens";

// Re-export types for consumers
export type {
  Label,
  LinkedRepoOption,
  Person,
  Team,
  ProjectStatus,
  ProjectPriority,
  ProjectHealth,
  ProjectData,
  PropertiesPanelProps,
} from "./types";

// ============================================
// Shell Component
// ============================================

export interface PropertiesPanelShellProps {
  /** Header title. Pass empty string to hide the header. */
  title?: string;
  /** Extra class on the outer section */
  className?: string;
  /**
   * Ref attached to the outer <section>.
   * Used for click-outside detection by property field hooks.
   * If not provided, an internal ref is created.
   */
  containerRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

const PropertiesPanel: React.FC<PropertiesPanelShellProps> = ({
  title,
  className = "",
  containerRef: externalRef,
  children,
}) => {
  const { t } = useTranslation("projects");
  const internalRef = useRef<HTMLElement | null>(null);
  const containerRef = externalRef ?? internalRef;
  const resolvedTitle = title ?? t("common:common.properties");
  const showHeader = resolvedTitle !== "";

  return (
    <section ref={containerRef} className={`flex h-full flex-col ${className}`}>
      {showHeader && (
        <div className={HEADER_CLASSES.sectionTitle}>
          <span className="text-[13px] font-medium text-text-1">
            {resolvedTitle}
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="flex flex-col pb-2">{children}</div>
      </div>
    </section>
  );
};

export default PropertiesPanel;
