import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useState } from "react";

import { LaunchpadDashboard } from "@src/modules/WorkStation/Launchpad/components";
import { openWorkspaceSpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";
import type { Repo } from "@src/store/repo";
import { repoLoadingAtom, reposAtom } from "@src/store/repo";
import {
  createLaunchpadRepoTab,
  openTab as openTabMutation,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";

function getRepoDisplayName(repo: Repo): string {
  return repo.name || repo.path?.split("/").pop() || "Repo";
}

export default function WorkspaceDashboardPanelView(): React.ReactElement {
  const repos = useAtomValue(reposAtom);
  const loading = useAtomValue(repoLoadingAtom);
  const setLayout = useSetAtom(workstationLayoutAtom);
  const [selectedDashboardRepoId, setSelectedDashboardRepoId] = useState<
    string | null
  >(null);

  const handleOpenRepoDetails = useCallback(
    (repo: Repo) => {
      const repoTab = createLaunchpadRepoTab({
        repoId: repo.id,
        repoName: getRepoDisplayName(repo),
        repoPath: repo.path ?? "",
      });
      setLayout((previousLayout) => ({
        ...previousLayout,
        mainPane: openTabMutation(previousLayout.mainPane, repoTab),
      }));
    },
    [setLayout]
  );

  return (
    <LaunchpadDashboard
      repos={repos}
      loading={loading}
      selectedDashboardRepoId={selectedDashboardRepoId}
      onSelectDashboardRepo={setSelectedDashboardRepoId}
      onOpenRepoDetails={handleOpenRepoDetails}
      onAddWorkspace={() => openWorkspaceSpotlight("add")}
    />
  );
}
