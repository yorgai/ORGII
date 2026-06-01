import { ROUTES } from "@src/config/routes";

import { DEFAULT_DOCK_FILTER, type DockFilter } from "./atoms";

export const DOCK_FILTER_QUERY_KEY = "filter";

/** Canonical `?filter=` search string for a dock filter (empty for `"all"`). */
export function composeDockFilterSearch(filter: DockFilter): string {
  if (filter === DEFAULT_DOCK_FILTER) return "";
  return `?${DOCK_FILTER_QUERY_KEY}=${filter}`;
}

/**
 * Workstation URL for a dock filter. Stays on the bare base path and uses
 * `?filter=` so filter changes do not rematch a different RR route element
 * (which can stall when Source Control / Terminal subtrees are suspended).
 */
export function buildDockFilterPath(filter: DockFilter): string {
  return `${ROUTES.workStation.base.path}${composeDockFilterSearch(filter)}`;
}
