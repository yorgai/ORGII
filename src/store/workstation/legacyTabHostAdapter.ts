/**
 * Maps a `WorkStationTabType` (or `WorkStationTabCategory`) onto the host
 * enum the AppShell uses to decide which content surface (Code Editor /
 * Browser / Database / Project Manager / Launchpad) the active tab
 * belongs to.
 *
 * The "host" projection is a UI-routing concern, not a registry concern,
 * which is why it lives outside `tabs/atoms.ts`. It exists because the
 * workstation only has a single flat tab pool (`mainPane`) — the
 * dispatch to a particular content renderer is derived from the active
 * tab's type rather than from a separate per-host pane bucket.
 *
 * (The name still carries the `Legacy` prefix because the host enum was
 * originally used by the routed multi-host workstation; the projection
 * is now type-based, but downstream consumers continue to use the same
 * literal set.)
 */
import type {
  WorkStationTab,
  WorkStationTabCategory,
  WorkStationTabType,
} from "./tabs/types";

export type LegacyPeekHost = "code" | "browser" | "data" | "project";

/**
 * Map a tab category onto its content host. Categories are the canonical
 * discriminator (they're already used by the renderer registry), so
 * type-based hosting falls out of them cleanly.
 *
 * Code-editor-family categories (file, git, terminal, search, settings,
 * lint, ai-impact, preview, subagent, chat, explorer, ops-control,
 * launchpad) all project onto `"code"` — they render inside the Code
 * Editor surface. (Launchpad tabs are pinned-and-regular tab types in
 * the unified main pane; the standalone Launchpad host was retired.)
 */
export function categoryToLegacyHost(
  category: WorkStationTabCategory | undefined
): LegacyPeekHost {
  switch (category) {
    case "browser":
      return "browser";
    case "db-table":
    case "db-query":
    case "db-schema":
      return "data";
    case "project":
      return "project";
    default:
      // file, explorer, git, search, terminal, settings, lint, ai-impact,
      // benchmark, preview, subagent, chat, ops-control, launchpad, or missing —
      // all render in the Code Editor surface.
      return "code";
  }
}

/**
 * Map a tab type onto its host. Convenience for callers that have the
 * raw `tab.type` literal (e.g. tab-bar filters) rather than the
 * category. Mirrors `categoryToLegacyHost` 1:1 via the tab-type →
 * category default mapping in `tabFactory.ts`.
 */
export function tabTypeToLegacyHost(type: WorkStationTabType): LegacyPeekHost {
  switch (type) {
    case "browser-session":
    case "component-preview":
    case "token-category":
    case "devtools":
      return "browser";
    case "table":
    case "query":
    case "schema":
    case "add-connection":
      return "data";
    case "project-dashboard":
    case "project-work-items":
    case "project-linear-projects":
    case "project-linear-work-items":
    case "project-settings":
    case "project-org":
    case "project-org-settings":
    case "project-git-sync-review":
    case "project-workitems":
    case "workItem-detail":
      return "project";
    default:
      // Includes launchpad-repo, which renders in the Code Editor surface
      // alongside file / git / terminal tabs.
      return "code";
  }
}

/** Convenience: derive host from a tab. */
export function tabToLegacyHost(tab: WorkStationTab): LegacyPeekHost {
  return tab.category
    ? categoryToLegacyHost(tab.category)
    : tabTypeToLegacyHost(tab.type);
}
