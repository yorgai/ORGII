/**
 * Renderer for `launchpad-repo` tabs.
 *
 * Resolves the repo from `tab.data.repoId` via `useRepoSelection` and
 * mounts `RepoDetailPage`. The dashboard / repo tabs now live in the
 * Code Editor's main pane (the standalone Launchpad host is gone), so
 * there is no external refresh reporter to wire into a host header —
 * `RepoDetailPage` owns its own refresh affordance via the `…` menu in
 * its detail-panel header.
 *
 * If the repo can no longer be found (deleted while the tab is open),
 * an empty placeholder is rendered. We deliberately do NOT close the
 * tab here — the user closes it via the tab bar.
 */
import { useAtomValue } from "jotai";
import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { usePublishWorkstationTabHeader } from "@src/hooks/workStation";
import RepoDetailPage from "@src/modules/WorkStation/Launchpad/components/RepoDetailPage";
import BreadcrumbFileHeader from "@src/modules/shared/components/FileHeader/BreadcrumbFileHeader";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { reposAtom } from "@src/store/repo";
import type { Repo } from "@src/store/repo/types";

import type { UnifiedTabContentProps } from "../types";

// Brand name kept verbatim across locales — the product is "Launchpad".
const LAUNCHPAD_LABEL = "Launchpad";

const LaunchpadRepoTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab, isActive }) => {
    const { t } = useTranslation("navigation");
    const repos = useAtomValue(reposAtom);

    const repoId = String(tab.data.repoId ?? "");
    const repoPath = String(tab.data.repoPath ?? "");
    const repoName = String(tab.data.repoName ?? "");

    const headerContent = useMemo(() => {
      const trailing = repoName || t("launchpad.workspaces");
      return (
        <BreadcrumbFileHeader
          filePath={`${LAUNCHPAD_LABEL}/${trailing}`}
          disableNavigation
        />
      );
    }, [repoName, t]);

    usePublishWorkstationTabHeader({
      host: "code",
      content: headerContent,
      enabled: isActive,
    });

    // Prefer the live repo record so detail content reflects current
    // state; fall back to a synthesized record built from the tab's
    // payload when the repo list hasn't loaded yet (or doesn't include
    // this repo, which would only happen if it was removed).
    const resolvedRepo = useMemo<Repo | null>(() => {
      const live = repos.find((repo) => repo.id === repoId) ?? null;
      if (live) return live;
      if (!repoId) return null;
      return {
        id: repoId,
        name: repoName,
        path: repoPath,
      } as Repo;
    }, [repos, repoId, repoName, repoPath]);

    if (!resolvedRepo) {
      return (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          fillParentHeight
          title={t("launchpad.detail.repoUnavailable", {
            defaultValue: "Workspace unavailable",
          })}
        />
      );
    }

    return <RepoDetailPage repo={resolvedRepo} />;
  }
);

LaunchpadRepoTabRenderer.displayName = "LaunchpadRepoTabRenderer";

export default LaunchpadRepoTabRenderer;
