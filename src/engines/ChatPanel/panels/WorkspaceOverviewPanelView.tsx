import { useAtom } from "jotai";
import {
  ArrowDown,
  ArrowUp,
  Diff,
  FolderGit2,
  FolderTree,
  GitBranch,
} from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { PropertyDropdownField } from "@src/components/PropertyField/PropertyDropdownField";
import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import WorkItemContentStack from "@src/modules/ProjectManager/WorkItems/components/WorkItemContentStack";
import { RepoDetailPage } from "@src/modules/shared/launchpad/components";
import { CodeMapExplorePanel } from "@src/modules/shared/launchpad/components/CodeMapExplorePanel";
import { CodeMapWorkspaceStatusPanel } from "@src/modules/shared/launchpad/components/CodeMapWorkspaceStatus";
import RepoActionButtons from "@src/modules/shared/launchpad/components/RepoActionButtons";
import { WorkspaceToolsReadiness } from "@src/modules/shared/launchpad/components/WorkspaceToolsReadiness";
import { useRepoDetection } from "@src/modules/shared/launchpad/hooks";
import {
  DetailPanelContainer,
  PanelFooter,
} from "@src/modules/shared/layouts/blocks";
import { useRepoGitStatus } from "@src/scaffold/GlobalSpotlight/hooks/useRepoGitStatus";
import {
  type ChatPanelSelectedWorkspace,
  WORKSPACE_OVERVIEW_TAB,
  type WorkspaceOverviewTab,
  chatPanelWorkspaceOverviewTabAtom,
} from "@src/store/ui/chatPanelAtom";

interface WorkspaceOverviewPanelViewProps {
  selectedWorkspace: ChatPanelSelectedWorkspace;
}

const WorkspaceOverviewPanelView: React.FC<WorkspaceOverviewPanelViewProps> =
  memo(({ selectedWorkspace }) => {
    const { t } = useTranslation(["navigation", "common"]);
    const [activeTab, setActiveTab] = useAtom(
      chatPanelWorkspaceOverviewTabAtom
    );
    const { repos } = useRepoSelection({ autoLoad: true });

    const selectedRepo = useMemo(
      () =>
        selectedWorkspace.kind === "repo"
          ? (repos.find((repo) => repo.id === selectedWorkspace.id) ?? null)
          : null,
      [repos, selectedWorkspace.id, selectedWorkspace.kind]
    );

    const isRepo = selectedWorkspace.kind === "repo";
    const detailsTabAvailable = isRepo && Boolean(selectedRepo);
    const { repoType, configFiles, hasDocker, hasMakefile } = useRepoDetection(
      selectedRepo?.path
    );

    // Force back to Overview when the selected workspace cannot show details
    // (workspace-kind, or repo not yet hydrated). Prevents a stale "details"
    // selection from showing a blank panel after switching workspaces.
    useEffect(() => {
      if (
        !detailsTabAvailable &&
        activeTab === WORKSPACE_OVERVIEW_TAB.DETAILS
      ) {
        setActiveTab(WORKSPACE_OVERVIEW_TAB.OVERVIEW);
      }
    }, [activeTab, detailsTabAvailable, setActiveTab]);

    // Single-repo git status only. Multi-root workspaces don't surface
    // an aggregated badge for now — agreed scope for this iteration.
    const repoIdsForStatus = useMemo(
      () => (selectedRepo ? [selectedRepo.id] : []),
      [selectedRepo]
    );
    const { gitStatusMap } = useRepoGitStatus({
      repoIds: repoIdsForStatus,
      selectedRepoId: selectedRepo?.id,
      enabled: Boolean(selectedRepo),
    });
    const repoGitStatus = selectedRepo
      ? gitStatusMap[selectedRepo.id]
      : undefined;

    const tabs = useMemo<TabPillItem[]>(() => {
      const items: TabPillItem[] = [
        {
          key: WORKSPACE_OVERVIEW_TAB.OVERVIEW,
          label: t("common:labels.overview"),
        },
      ];
      if (detailsTabAvailable) {
        items.push({
          key: WORKSPACE_OVERVIEW_TAB.DETAILS,
          label: t("common:labels.details"),
        });
      }
      return items;
    }, [detailsTabAvailable, t]);

    const handleTabChange = useCallback(
      (key: string) => {
        setActiveTab(key as WorkspaceOverviewTab);
      },
      [setActiveTab]
    );

    const resolvedActiveTab: WorkspaceOverviewTab = detailsTabAvailable
      ? activeTab
      : WORKSPACE_OVERVIEW_TAB.OVERVIEW;

    // Internal breadcrumb row — mirrors WorkItem/Project panels'
    // pathContent slot (org > project pills). For the workspace
    // overview, we surface a single pill identifying the kind (workspace
    // vs. repo) so users always see a consistent context indicator.
    const kindLabel =
      selectedWorkspace.kind === "workspace"
        ? t("common:workspaceForm.multiRepoWorkspace")
        : t("common:selectors.repo.sections.repo");
    const headerPath = (
      <div
        className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
        data-testid="chat-panel-workspace-overview-breadcrumb"
      >
        <PropertyDropdownField
          value={selectedWorkspace.kind}
          label={kindLabel}
          icon={
            selectedWorkspace.kind === "workspace" ? (
              <FolderTree size={13} strokeWidth={1.8} />
            ) : (
              <FolderGit2 size={13} strokeWidth={1.8} />
            )
          }
          placement="portal"
          fieldVariant="pill"
          triggerVariant="pill"
          readonly
          searchable={false}
          selected
          maxWidthClassName="max-w-[220px] shrink-0"
        />
      </div>
    );

    // Internal property row — read-only git status for the selected
    // repo, styled like the WorkStation StatusBar (branch chip + counts
    // for behind/ahead/uncommitted). Hidden entirely for multi-root
    // workspaces or when no repo is selected.
    const branchName = selectedRepo?.branch;
    const uncommitted = repoGitStatus?.uncommittedFiles ?? 0;
    const ahead = repoGitStatus?.ahead ?? 0;
    const behind = repoGitStatus?.behind ?? 0;
    const hasGitActivity = uncommitted > 0 || ahead > 0 || behind > 0;
    const inlineProperties = selectedRepo ? (
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-text-2">
        {branchName && (
          <span
            className="flex items-center gap-1.5"
            title={t("workstation.branchTooltip", { branch: branchName })}
          >
            <GitBranch size={13} strokeWidth={2} className="text-text-2" />
            <span className="font-medium text-text-1">{branchName}</span>
          </span>
        )}
        {hasGitActivity ? (
          <span className="flex items-center gap-3">
            {uncommitted > 0 && (
              <span
                className="flex items-center gap-1"
                title={`${uncommitted} file${uncommitted !== 1 ? "s" : ""} uncommitted`}
              >
                <Diff size={12} />
                <span className="tabular-nums">{uncommitted}</span>
              </span>
            )}
            {behind > 0 && (
              <span
                className="flex items-center gap-1"
                title={`${behind} commit${behind !== 1 ? "s" : ""} behind`}
              >
                <ArrowDown size={12} />
                <span className="tabular-nums">{behind}</span>
              </span>
            )}
            {ahead > 0 && (
              <span
                className="flex items-center gap-1"
                title={`${ahead} commit${ahead !== 1 ? "s" : ""} ahead`}
              >
                <ArrowUp size={12} />
                <span className="tabular-nums">{ahead}</span>
              </span>
            )}
          </span>
        ) : (
          branchName && (
            <span className="text-text-3">{t("common:status.noChanges")}</span>
          )
        )}
      </div>
    ) : null;

    const handleOpenDetails = useCallback(() => {
      setActiveTab(WORKSPACE_OVERVIEW_TAB.DETAILS);
    }, [setActiveTab]);

    const detailsBody =
      resolvedActiveTab === WORKSPACE_OVERVIEW_TAB.DETAILS && selectedRepo ? (
        <RepoDetailPage repo={selectedRepo} />
      ) : null;

    const overviewBody =
      resolvedActiveTab === WORKSPACE_OVERVIEW_TAB.OVERVIEW && selectedRepo ? (
        <>
          <CodeMapWorkspaceStatusPanel workspacePath={selectedRepo.path} />
          <CodeMapExplorePanel workspacePath={selectedRepo.path} />
          <WorkspaceToolsReadiness
            workspacePath={selectedRepo.path}
            repoType={repoType}
            configFiles={configFiles}
            hasDocker={hasDocker}
            hasMakefile={hasMakefile}
          />
        </>
      ) : null;

    const actionFooter =
      selectedRepo && resolvedActiveTab === WORKSPACE_OVERVIEW_TAB.OVERVIEW ? (
        <PanelFooter
          left={
            <RepoActionButtons
              repo={selectedRepo}
              onOpenDetails={handleOpenDetails}
              shape="square"
              showDetails={false}
              showClose={false}
              className="overflow-x-auto scrollbar-hide"
            />
          }
        />
      ) : null;

    const descriptionContent = (
      <section
        className="flex flex-col"
        data-testid="chat-panel-workspace-overview-section"
      >
        <div className="mb-4 flex items-center justify-start">
          <TabPill
            tabs={tabs}
            activeTab={resolvedActiveTab}
            onChange={handleTabChange}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        </div>
        {overviewBody}
        {detailsBody}
      </section>
    );

    return (
      <div
        className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
        data-testid="chat-panel-workspace-overview-detail"
      >
        <DetailPanelContainer testId="workspace-overview-panel">
          <WorkItemContentStack
            pathContent={headerPath}
            propertiesContent={inlineProperties}
            descriptionContent={descriptionContent}
            descriptionFlexible
            scrollable
          />
          {actionFooter}
        </DetailPanelContainer>
      </div>
    );
  });

WorkspaceOverviewPanelView.displayName = "WorkspaceOverviewPanelView";

export default WorkspaceOverviewPanelView;
