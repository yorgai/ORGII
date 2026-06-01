/**
 * Launchpad Tab Factories
 *
 * The Launchpad hosts two kinds of tabs:
 *
 *   - `launchpad-dashboard` — pinned, singleton, non-closable. Shows the
 *     workspaces grid. Acts as the launchpad's "home" tab, parallel to the
 *     Code Editor's Explorer tab.
 *   - `launchpad-repo`      — keyed by repo id. Opens the per-repo detail page
 *     (env vars, scripts, analysis) when the user clicks a repo in the
 *     sidebar or in the dashboard grid.
 */
import { defineTabFactory } from "../tabFactory";
import type { WorkStationTab } from "../types";

// ============================================
// Dashboard (singleton, pinned)
// ============================================

export const LAUNCHPAD_DASHBOARD_TAB_ID = "launchpad-dashboard:main";

export const launchpadDashboardTabFactory = defineTabFactory<
  Record<string, never>
>({
  tabType: "launchpad-dashboard",
  idStrategy: { type: "singleton", id: LAUNCHPAD_DASHBOARD_TAB_ID },
  getTitle: () => "Dashboard",
  icon: "LayoutDashboard",
  closable: false,
  pinned: true,
});

export function createLaunchpadDashboardTab(): WorkStationTab {
  return launchpadDashboardTabFactory({});
}

// ============================================
// Repo detail (keyed by repo id)
// ============================================

export interface LaunchpadRepoTabData {
  /** Stable repo id (matches `Repo.id`) */
  repoId: string;
  /** Repo display name; falls back to the trailing path segment if absent */
  repoName: string;
  /** Absolute filesystem path of the repo */
  repoPath: string;
}

export const launchpadRepoTabFactory = defineTabFactory<LaunchpadRepoTabData>({
  tabType: "launchpad-repo",
  idStrategy: {
    type: "keyed",
    prefix: "launchpad-repo",
    getKey: (data) => data.repoId,
  },
  getTitle: (data) => data.repoName,
  icon: "FolderGit2",
});

export function createLaunchpadRepoTab(
  data: LaunchpadRepoTabData
): WorkStationTab {
  return launchpadRepoTabFactory(data);
}
