/**
 * Launchpad Tab Factories
 *
 * Launchpad repo details remain as keyed tabs. The workspace dashboard grid
 * has moved into the Folders sidebar and chat panel overview surfaces.
 */
import { defineTabFactory } from "../tabFactory";
import type { WorkStationTab } from "../types";

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
