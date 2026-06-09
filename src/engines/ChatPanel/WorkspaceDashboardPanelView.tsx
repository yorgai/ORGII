import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useState } from "react";

import { LaunchpadDashboard } from "@src/modules/shared/launchpad/components";
import { openWorkspaceSpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";
import type { Repo } from "@src/store/repo";
import { repoLoadingAtom, reposAtom } from "@src/store/repo";
import {
  CHAT_PANEL_SURFACE_KIND,
  WORKSPACE_OVERVIEW_TAB,
  chatPanelNavigateAtom,
} from "@src/store/ui/chatPanelAtom";

function repoDisplayName(repo: Repo): string {
  return repo.name || repo.path?.split("/").pop() || "Repo";
}

export default function WorkspaceDashboardPanelView(): React.ReactElement {
  const repos = useAtomValue(reposAtom);
  const loading = useAtomValue(repoLoadingAtom);
  const navigateChatPanel = useSetAtom(chatPanelNavigateAtom);
  const [selectedDashboardRepoId, setSelectedDashboardRepoId] = useState<
    string | null
  >(null);

  // "Open details" navigates to the existing workspace overview surface
  // (the same surface the sidebar opens for a repo) and pre-selects the
  // Details tab. We close the dashboard so that the overview replaces it
  // in the same chat-panel slot — there is no separate detail mode.
  const handleOpenRepoDetails = useCallback(
    (repo: Repo) => {
      navigateChatPanel({
        kind: CHAT_PANEL_SURFACE_KIND.WORKSPACE_OVERVIEW,
        workspace: {
          kind: "repo",
          id: repo.id,
          name: repoDisplayName(repo),
          path: repo.path ?? undefined,
        },
        tab: WORKSPACE_OVERVIEW_TAB.DETAILS,
      });
    },
    [navigateChatPanel]
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
