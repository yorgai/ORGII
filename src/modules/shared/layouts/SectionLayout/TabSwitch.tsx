/**
 * SectionTabSwitch Component
 *
 * Reusable tab switcher for use inside SectionLayout pages.
 * Renders a tab switcher (TabPill variant="simple" fillWidth)
 * at the top of a section, switching between different content views.
 *
 * @example
 * ```tsx
 * <SectionTabSwitch
 *   tabs={[
 *     { key: "repo", label: t("settings.repoMembers") },
 *     { key: "workspace", label: t("settings.workspaceMembers") },
 *   ]}
 *   activeTab={activeTab}
 *   onChange={setActiveTab}
 * />
 * ```
 */
import React, { memo } from "react";

import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";

export interface SectionTabSwitchProps {
  /** Tab items — shorthand strings or full TabPillItem objects */
  tabs: (TabPillItem | string)[];
  /** Currently active tab key */
  activeTab: string;
  /** Callback when tab changes */
  onChange: (key: string) => void;
  /** Tab size: "small" for dense toolbars, "large" for 16px section-level switches. Default: "default" */
  size?: "small" | "default" | "large";
  /** Whether tabs stretch to fill available width. Default: false */
  fillWidth?: boolean;
  /** Additional className for the wrapper */
  className?: string;
}

const SectionTabSwitch: React.FC<SectionTabSwitchProps> = memo(
  ({
    tabs,
    activeTab,
    onChange,
    size = "default",
    fillWidth = false,
    className = "",
  }) => {
    return (
      <div
        className={`sticky top-[47px] z-10 bg-bg-2 pb-1 pl-1 ${className}`.trim()}
      >
        <TabPill
          tabs={tabs}
          activeTab={activeTab}
          onChange={onChange}
          variant="simple"
          fillWidth={fillWidth}
          size={size}
        />
      </div>
    );
  }
);

SectionTabSwitch.displayName = "SectionTabSwitch";

export default SectionTabSwitch;
