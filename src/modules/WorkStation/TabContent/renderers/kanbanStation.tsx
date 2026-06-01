/**
 * Renderer wrapper for `kanban-station` tabs.
 *
 * `kanban-station` is a marker tab type: AppShell currently renders
 * the OpsControl page (`@src/modules/MainApp/OpsControl`) when this
 * tab is active rather than mounting per-tab content. Phase 1b keeps
 * that semantic by rendering a placeholder; AppShell will continue
 * to own the OpsControl mount until Phase 2 collapses the hosts.
 *
 * TODO(phase-2): move the OpsControl mount into this wrapper once
 * AppShell can dispatch its sidebar through the dispatcher context.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const KanbanStationTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => (
    <HostCoupledPlaceholder
      tabType={tab.type}
      title={String(tab.title ?? "Kanban Station")}
      hostNote="Kanban Station (OpsControl) still rendered by AppShell. Phase 2 will move the OpsControl mount into the unified dispatcher."
    />
  )
);

KanbanStationTabRenderer.displayName = "KanbanStationTabRenderer";

export default KanbanStationTabRenderer;
