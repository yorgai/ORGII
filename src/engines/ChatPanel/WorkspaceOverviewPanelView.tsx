import { openPath } from "@tauri-apps/plugin-opener";
import { useSetAtom } from "jotai";
import {
  ExternalLink,
  FolderGit2,
  FolderSearch,
  FolderTree,
  Plus,
} from "lucide-react";
import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Message from "@src/components/Message";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import {
  CollapsibleSection,
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  Placeholder,
} from "@src/modules/shared/layouts/blocks";
import { openWorkspaceSpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";
import type { Repo } from "@src/store/repo/types";
import {
  type ChatPanelSelectedWorkspace,
  chatPanelSelectedWorkspaceAtom,
} from "@src/store/ui/chatPanelAtom";
import { getFileManagerRevealLabelKey } from "@src/util/platform/fileManagerLabels";

interface WorkspaceOverviewPanelViewProps {
  selectedWorkspace: ChatPanelSelectedWorkspace;
}

function repoDisplayName(repo: Repo): string {
  return repo.name || repo.path?.split("/").pop() || "Repo";
}

const WorkspaceOverviewPanelView: React.FC<WorkspaceOverviewPanelViewProps> =
  memo(({ selectedWorkspace }) => {
    const { t } = useTranslation(["navigation", "common"]);
    const setSelectedWorkspace = useSetAtom(chatPanelSelectedWorkspaceAtom);
    const { repos } = useRepoSelection({ autoLoad: true });
    const selectedRepo = useMemo(
      () =>
        selectedWorkspace.kind === "repo"
          ? (repos.find((repo) => repo.id === selectedWorkspace.id) ?? null)
          : null,
      [repos, selectedWorkspace.id, selectedWorkspace.kind]
    );

    const workspaceFolders = useMemo(() => {
      if (selectedWorkspace.kind !== "workspace") return [];
      return (
        selectedWorkspace.repoIds
          ?.map((repoId) => repos.find((repo) => repo.id === repoId))
          .filter((repo): repo is Repo => Boolean(repo)) ?? []
      );
    }, [repos, selectedWorkspace.kind, selectedWorkspace.repoIds]);

    const visibleRepos = selectedRepo ? [selectedRepo] : workspaceFolders;

    const handleOpenDetails = useCallback(() => {
      if (selectedWorkspace.kind === "repo" && selectedRepo) {
        setSelectedWorkspace({
          kind: "repo",
          id: selectedRepo.id,
          name: repoDisplayName(selectedRepo),
          path: selectedRepo.path ?? undefined,
        });
      }
    }, [selectedRepo, selectedWorkspace.kind, setSelectedWorkspace]);

    const handleShowInFinder = useCallback(async () => {
      const targetPath = selectedWorkspace.path ?? selectedRepo?.path;
      if (!targetPath) return;
      try {
        await openPath(targetPath);
      } catch (error) {
        Message.error(
          t("common:errors.openInFinderFailed", {
            defaultValue: "Failed to open in Finder",
          })
        );
      }
    }, [selectedRepo?.path, selectedWorkspace.path, t]);

    const handleAddWorkspace = useCallback(() => {
      openWorkspaceSpotlight("add");
    }, []);

    return (
      <DetailPanelContainer testId="workspace-overview-panel">
        <div className={DETAIL_PANEL_TOKENS.scrollContent}>
          <div className={DETAIL_PANEL_TOKENS.sectionGap}>
            <div className="rounded-xl border border-border-2 bg-fill-1 p-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-1 text-primary-6">
                  {selectedWorkspace.kind === "workspace" ? (
                    <FolderTree size={20} strokeWidth={1.8} />
                  ) : (
                    <FolderGit2 size={20} strokeWidth={1.8} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-text-1">
                    {selectedWorkspace.name}
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-text-3">
                    {selectedWorkspace.kind === "workspace"
                      ? t("common:workspaceForm.multiRepoWorkspace")
                      : t("common:selectors.repo.sections.repo")}
                  </div>
                  {selectedWorkspace.path ? (
                    <div
                      className="mt-2 truncate text-[12px] text-text-3"
                      title={selectedWorkspace.path}
                    >
                      {selectedWorkspace.path}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  appearance="outline"
                  size="small"
                  icon={<ExternalLink size={13} strokeWidth={2} />}
                  onClick={handleOpenDetails}
                >
                  {t("common:actions.open")}
                </Button>
                {(selectedWorkspace.path || selectedRepo?.path) && (
                  <Button
                    variant="secondary"
                    appearance="outline"
                    size="small"
                    icon={<FolderSearch size={13} strokeWidth={2} />}
                    onClick={handleShowInFinder}
                  >
                    {t(getFileManagerRevealLabelKey())}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  appearance="outline"
                  size="small"
                  icon={<Plus size={13} strokeWidth={2} />}
                  onClick={handleAddWorkspace}
                >
                  {t("common:actions.addWorkspace")}
                </Button>
              </div>
            </div>
          </div>

          <CollapsibleSection title={t("common:labels.overview")} defaultOpen>
            <div className="rounded-lg border border-border-2 bg-fill-1 p-3">
              <div className="flex items-center gap-2 text-[12px] text-text-3">
                <FolderGit2 size={13} strokeWidth={2} />
                {t("common:selectors.repo.sections.repo")}
              </div>
              <div className="mt-1 text-[20px] font-semibold text-text-1">
                {visibleRepos.length ||
                  (selectedWorkspace.kind === "repo" ? 1 : 0)}
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title={t("common:selectors.repo.sections.repo")}
            defaultOpen
          >
            {visibleRepos.length > 0 ? (
              <div className="flex flex-col gap-2">
                {visibleRepos.map((repo) => (
                  <div
                    key={repo.id}
                    className="flex min-w-0 items-center gap-2 rounded-lg border border-border-2 bg-fill-1 px-3 py-2"
                  >
                    <FolderGit2
                      size={14}
                      strokeWidth={2}
                      className="shrink-0 text-primary-6"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-text-1">
                        {repoDisplayName(repo)}
                      </div>
                      {repo.path ? (
                        <div
                          className="truncate text-[11px] text-text-3"
                          title={repo.path}
                        >
                          {repo.path}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Placeholder
                variant="empty"
                placement="sidebar"
                title={t("navigation:launchpad.emptyWorkspaces")}
              />
            )}
          </CollapsibleSection>
        </div>
      </DetailPanelContainer>
    );
  });

WorkspaceOverviewPanelView.displayName = "WorkspaceOverviewPanelView";

export default WorkspaceOverviewPanelView;
