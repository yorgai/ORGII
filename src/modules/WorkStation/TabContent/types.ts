/**
 * Unified Tab Content — types
 *
 * Phase 1b of the WorkStation tab-rendering unification. Every renderer
 * registered in `registry.ts` is a tiny wrapper that accepts the same
 * `UnifiedTabContentProps` and adapts the generic `WorkStationTab` into
 * whatever the underlying view component expects.
 *
 * Renderer wrappers are intentionally narrow: they own ONLY the
 * `tab.data` → component-props adaptation. Host concerns (atoms, contexts,
 * ActionSystem wiring) stay outside this layer and are addressed in
 * Phase 2 when AppShell collapses around this dispatcher.
 */
import type { ComponentType, LazyExoticComponent } from "react";

import type {
  WorkStationTab,
  WorkStationTabType,
} from "@src/store/workstation/tabs/types";

export interface UnifiedTabContentProps<
  TTab extends WorkStationTab = WorkStationTab,
> {
  /** The tab whose content this renderer is responsible for. */
  tab: TTab;
  /** ID of the pane that owns this tab (for split-pane awareness). */
  paneId: string;
  /** Whether this tab is the active tab in its pane. */
  isActive: boolean;
}

export interface RendererEntry {
  /** Lazy component that renders this tab's content. */
  Component: LazyExoticComponent<ComponentType<UnifiedTabContentProps>>;
  /**
   * Whether the renderer needs an active repo (file/git-diff/source-control,
   * etc.). Used by the AppShell guard introduced in Phase 2.
   */
  requiresRepo?: boolean;
  /** Optional human label for debug tooling. */
  debugLabel?: string;
}

export type TabContentRegistry = Record<WorkStationTabType, RendererEntry>;
