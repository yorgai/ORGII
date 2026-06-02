/**
 * Renderer for `launchpad-dashboard` tabs.
 *
 * The Launchpad is no longer a standalone WorkStation host — its
 * dashboard now renders directly inside the Code Editor's main pane as
 * the first pinned tab. This wrapper owns the small amount of host glue
 * the dashboard previously got from `Launchpad/index.tsx`:
 *
 *   - resolves the repo list via `useRepoSelection`,
 *   - owns the dashboard-local selection atom (workspace card highlight),
 *   - on `Open details`, mutates `workstationLayoutAtom` to add a
 *     keyed `launchpad-repo` tab and activate it,
 *   - on `Add repo`, opens the workspace spotlight, and
 *   - publishes its own 40px header content into the global tab-header
 *     strip — a static `Launchpad / Dashboard` breadcrumb (the brand name
 *     "Launchpad" is intentionally left untranslated). Search / Testing
 *     icons in `CodeSidebarHeaderActions` are gated off for launchpad
 *     tabs.
 *
 * The companion `launchpad-dashboard` sidebar (Workspaces list) is
 * provided by `WorkspacesTabSidebar` via the TAB_SIDEBAR_REGISTRY — the
 * registry is populated by the side-effect import in
 * `CodeEditor/index.tsx`.
 */
import { useAtom, useSetAtom } from "jotai";
import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { usePublishWorkstationTabHeader } from "@src/hooks/workStation";
import LaunchpadDashboard from "@src/modules/WorkStation/Launchpad/components/LaunchpadDashboard";
import { launchpadSelectedRepoIdAtom } from "@src/modules/WorkStation/Launchpad/store/launchpadSelectedRepoAtom";
import BreadcrumbFileHeader from "@src/modules/shared/components/FileHeader/BreadcrumbFileHeader";
import { openWorkspaceSpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";
import { CODE_EDITOR_TOUR_TARGETS } from "@src/scaffold/Tutorials/codeEditorTourConfig";
import type { Repo } from "@src/store/repo/types";
import {
  createLaunchpadRepoTab,
  openTab as openTabMutation,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";

import type { UnifiedTabContentProps } from "../types";

// Brand name kept verbatim across locales — the product is "Launchpad".
const LAUNCHPAD_LABEL = "Launchpad";

const LaunchpadDashboardTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ isActive }) => {
    const { t } = useTranslation("navigation");
    const { repos, repoLoading } = useRepoSelection({ autoLoad: true });
    const [selectedDashboardRepoId, setSelectedDashboardRepoId] = useAtom(
      launchpadSelectedRepoIdAtom
    );
    const setLayout = useSetAtom(workstationLayoutAtom);

    const handleOpenRepoDetails = useCallback(
      (repo: Repo) => {
        const tab = createLaunchpadRepoTab({
          repoId: repo.id,
          repoName: repo.name || repo.path?.split("/").pop() || "Repo",
          repoPath: repo.path ?? "",
        });
        setLayout((prev) => ({
          ...prev,
          mainPane: openTabMutation(prev.mainPane, tab),
        }));
      },
      [setLayout]
    );

    const handleAddWorkspace = useCallback(() => {
      openWorkspaceSpotlight("add");
    }, []);

    const headerContent = useMemo(
      () => (
        <BreadcrumbFileHeader
          filePath={`${LAUNCHPAD_LABEL}/${t("launchpad.dashboard")}`}
          disableNavigation
        />
      ),
      [t]
    );

    usePublishWorkstationTabHeader({
      host: "code",
      content: headerContent,
      enabled: isActive,
    });

    return (
      <div
        className="h-full min-h-0 w-full"
        data-tour-target={CODE_EDITOR_TOUR_TARGETS.dashboard}
      >
        <LaunchpadDashboard
          repos={repos}
          loading={repoLoading}
          selectedDashboardRepoId={selectedDashboardRepoId}
          onSelectDashboardRepo={setSelectedDashboardRepoId}
          onOpenRepoDetails={handleOpenRepoDetails}
          onAddWorkspace={handleAddWorkspace}
        />
      </div>
    );
  }
);

LaunchpadDashboardTabRenderer.displayName = "LaunchpadDashboardTabRenderer";

export default LaunchpadDashboardTabRenderer;
