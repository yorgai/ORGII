/**
 * HierarchyModeSelector — picks how the org's reports-to hierarchy is
 * interpreted at runtime. Used by both `AgentTeamWizard` (creation flow) and
 * `OrgDetailView` (edit flow).
 *
 * Three modes (`flat` / `soft` / `strict`) map 1:1 to backend
 * `HierarchyMode`. See `src/modules/MainApp/AgentOrgs/types.ts` for
 * semantics; the per-mode descriptions live in the info tooltip beside
 * the dropdown.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import Select from "@src/components/Select";
import {
  HIERARCHY_MODES,
  type HierarchyMode,
} from "@src/modules/MainApp/AgentOrgs/types";
import { SECTION_CONTROL_STYLE } from "@src/modules/shared/layouts/SectionLayout/tokens";
import { HintWithInfo } from "@src/modules/shared/layouts/blocks";

interface HierarchyModeSelectorProps {
  value: HierarchyMode;
  onChange: (next: HierarchyMode) => void;
}

const HierarchyModeSelector: React.FC<HierarchyModeSelectorProps> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation("integrations");

  const options = HIERARCHY_MODES.map((mode) => ({
    label: t(`agentOrgs.orgWizard.hierarchyMode.${mode}.label`),
    value: mode,
    dataTestId: `agent-orgs-hierarchy-mode-${mode}`,
  }));

  const tooltipContent = (
    <div className="flex flex-col gap-2">
      {HIERARCHY_MODES.map((mode) => (
        <div key={mode}>
          <strong>
            {t(`agentOrgs.orgWizard.hierarchyMode.${mode}.label`)}
          </strong>
          <div>
            {t(`agentOrgs.orgWizard.hierarchyMode.${mode}.description`)}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex items-center gap-2">
      <HintWithInfo content={tooltipContent} position="left" />
      <Select
        value={value}
        size="default"
        onChange={(next) => onChange(next as HierarchyMode)}
        options={options}
        style={SECTION_CONTROL_STYLE}
        dataTestId="agent-orgs-hierarchy-mode-select"
      />
    </div>
  );
};

export default HierarchyModeSelector;
