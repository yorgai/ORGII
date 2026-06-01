/**
 * Renderer wrapper for `project-settings` tabs.
 *
 * Project settings is wired today through `RepoSettingsTabContent`
 * inside `ProjectManagerContentRouter`, depending on `onCloseTab`,
 * `onUpdateTabData`, and `onUpdateTabMeta`.
 *
 * TODO(phase-2): expose the tab mutators through the dispatcher
 * context so this surface can render standalone.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const ProjectSettingsTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => (
    <HostCoupledPlaceholder
      tabType={tab.type}
      title={String(tab.title ?? "Project Settings")}
      hostNote="Project settings still rendered by ProjectManagerContentRouter (needs tab mutators). Phase 2 will lift these through the dispatcher context."
    />
  )
);

ProjectSettingsTabRenderer.displayName = "ProjectSettingsTabRenderer";

export default ProjectSettingsTabRenderer;
