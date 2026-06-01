/**
 * Renderer wrapper for `project-workitems` (no-hyphen variant) tabs.
 *
 * Same renderer surface as `project-work-items` today (the router
 * deduplicates via the `persistentWorkItemTabs` list). Phase 1b
 * keeps both registry entries so the union check passes; Phase 2
 * is expected to merge the spelling.
 *
 * Filename has a `Compat` suffix because macOS / Windows treat
 * `projectWorkitems.tsx` and `projectWorkItems.tsx` as the same
 * file (case-insensitive FS). Once the spellings are merged in
 * Phase 2 this file can be deleted.
 *
 * TODO(phase-2): merge with `project-work-items` once the persistent
 * tab cache is moved into the wrapper, then delete this file.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const ProjectWorkitemsCompatTabRenderer: React.FC<UnifiedTabContentProps> =
  memo(({ tab }) => (
    <HostCoupledPlaceholder
      tabType={tab.type}
      title={String(tab.title ?? "Work Items")}
      hostNote="Project workitems (no-hyphen alias) still rendered by ProjectManagerContentRouter (keep-alive cache). Phase 2 will lift this through the dispatcher context and merge with project-work-items."
    />
  ));

ProjectWorkitemsCompatTabRenderer.displayName =
  "ProjectWorkitemsCompatTabRenderer";

export default ProjectWorkitemsCompatTabRenderer;
