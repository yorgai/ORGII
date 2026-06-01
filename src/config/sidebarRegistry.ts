/**
 * Sidebar Route Helpers
 *
 * Maps routes to sidebar IDs via simple prefix matching.
 * Both sidebars share identical behaviour (macOS-only, resizable, collapsible)
 * so no per-sidebar config object is needed — just the ID for layout decisions.
 */
import { ROUTES } from "./routes";

export type SidebarId = "home-sidebar" | "session-sidebar";

const SIDEBAR_PREFIXES: [SidebarId, string][] = [
  ["home-sidebar", "/orgii/app/"],
  ["session-sidebar", ROUTES.workStation.base.path],
];

const FORCE_VISIBLE_SIDEBAR_PREFIXES: string[] = [];

/** Pages that must NOT show a sidebar. */
const NO_SIDEBAR_PREFIXES: string[] = [
  ROUTES.app.home.selectRepo.path,
  ROUTES.auth.login.path,
  ROUTES.auth.setup.path,
];

function isExcluded(pathname: string): boolean {
  return NO_SIDEBAR_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function hasForceVisibleSidebar(pathname: string): boolean {
  if (isExcluded(pathname)) return false;
  return FORCE_VISIBLE_SIDEBAR_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );
}

/** Does this route show a sidebar? */
export function hasSidebar(pathname: string): boolean {
  if (isExcluded(pathname)) return false;
  return SIDEBAR_PREFIXES.some(([, prefix]) => pathname.startsWith(prefix));
}

/** Return the sidebar ID for a route, or null if the route has no sidebar. */
export function getSidebarId(pathname: string): SidebarId | null {
  if (isExcluded(pathname)) return null;
  for (const [id, prefix] of SIDEBAR_PREFIXES) {
    if (pathname.startsWith(prefix)) return id;
  }
  return null;
}
