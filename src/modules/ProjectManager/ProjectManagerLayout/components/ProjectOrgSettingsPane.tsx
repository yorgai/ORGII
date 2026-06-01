import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  PROJECT_ORG_SYNC_PROVIDER,
  type ProjectOrg,
  type SyncProjectOrgGitFolderResult,
} from "@src/api/http/project";
import type { MemberEntry } from "@src/api/http/project";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";
import {
  SECTION_ACTION_GAP_CLASSES,
  SECTION_DESCRIPTION_CLASSES,
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import {
  CARD_ROW_TOKENS,
  DETAIL_PANEL_TOKENS,
  InternalHeader,
} from "@src/modules/shared/layouts/blocks";
import type { Label } from "@src/types/core/shared";

import { RepoMembersSection } from "../../Projects/components/RepoSettings/sections";
import { LabelsSection } from "../../WorkItems/components/WorkItemsSettings/subpages";

const PROJECT_ORG_SETTINGS_TAB = {
  SYNC_METHODS: "sync-methods",
  MEMBERS: "members",
  LABELS: "labels",
} as const;

type ProjectOrgSettingsTab =
  (typeof PROJECT_ORG_SETTINGS_TAB)[keyof typeof PROJECT_ORG_SETTINGS_TAB];

function isProjectOrgSettingsTab(
  value: string
): value is ProjectOrgSettingsTab {
  return Object.values(PROJECT_ORG_SETTINGS_TAB).some((tab) => tab === value);
}

const SyncMethodsSection: React.FC<{
  org: ProjectOrg | null;
  folderPath: string;
  onFolderPathChange: (value: string) => void;
  onConfigure: () => Promise<void>;
  onSyncNow: () => Promise<SyncProjectOrgGitFolderResult | null>;
}> = ({ org, folderPath, onFolderPathChange, onConfigure, onSyncNow }) => {
  const { t } = useTranslation(["projects", "common"]);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] =
    useState<SyncProjectOrgGitFolderResult | null>(null);

  const isGitFolder =
    org?.sync_provider === PROJECT_ORG_SYNC_PROVIDER.GIT_FOLDER;

  const handleConfigure = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await onConfigure();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [onConfigure]);

  const handleSyncNow = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      setLastResult(await onSyncNow());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, [onSyncNow]);

  return (
    <div className={SECTION_GAP_CLASSES}>
      <SectionContainer>
        <SectionRow
          label={t("projects:orgs.management.gitFolderSync")}
          description={t("projects:orgs.management.gitFolderSyncDescription")}
        >
          <span className="rounded-full bg-fill-2 px-2 py-0.5 text-xs text-text-2">
            {isGitFolder
              ? t("projects:orgs.gitFolderBadge")
              : t("projects:orgs.management.notConfigured")}
          </span>
        </SectionRow>
        <SectionRow
          label={t("projects:orgs.gitFolderPath")}
          description={t("projects:orgs.gitFolderPathHint")}
          layout="vertical"
        >
          <div className="flex w-full min-w-0 items-center gap-2">
            <Input
              value={folderPath}
              onChange={onFolderPathChange}
              placeholder={t("projects:orgs.gitFolderPathPlaceholder")}
              className="min-w-0 flex-1"
            />
            <Button
              onClick={handleConfigure}
              disabled={saving || !folderPath.trim()}
            >
              {saving
                ? t("common:status.saving")
                : t("common:actions.configure")}
            </Button>
          </div>
        </SectionRow>
      </SectionContainer>
      <SectionContainer>
        <SectionRow
          label={t("projects:settings.sidebarSync")}
          description={t("projects:orgs.management.syncNowDescription")}
        >
          <div className={SECTION_ACTION_GAP_CLASSES}>
            {lastResult && (
              <span className="text-xs text-text-2">
                {t("projects:orgs.management.syncSummary", {
                  projects:
                    lastResult.projects_exported + lastResult.projects_imported,
                  workItems:
                    lastResult.work_items_exported +
                    lastResult.work_items_imported,
                  conflicts: lastResult.conflicts.length,
                })}
              </span>
            )}
            <Button onClick={handleSyncNow} disabled={syncing || !isGitFolder}>
              {syncing ? t("common:status.syncing") : t("common:actions.sync")}
            </Button>
          </div>
        </SectionRow>
        {error && (
          <SectionRow label="" indent showHeader={false}>
            <div className="rounded-md border border-danger-6/30 bg-danger-2/20 px-3 py-2 text-xs text-danger-6">
              {error}
            </div>
          </SectionRow>
        )}
      </SectionContainer>
      <p className={`px-1 ${SECTION_DESCRIPTION_CLASSES}`}>
        {t("projects:orgs.management.syncHowItWorks")}
      </p>
    </div>
  );
};

const EmptyOrgCatalogHint: React.FC = () => {
  const { t } = useTranslation("projects");
  return (
    <SectionContainer>
      <SectionRow label="" showHeader={false}>
        <div className={CARD_ROW_TOKENS.emptyState}>
          <div className="flex flex-col gap-1">
            <span>{t("orgs.management.noProjectsForCatalog")}</span>
            <span className={SECTION_DESCRIPTION_CLASSES}>
              {t("orgs.management.noProjectsForCatalogHint")}
            </span>
          </div>
        </div>
      </SectionRow>
    </SectionContainer>
  );
};

export interface ProjectOrgSettingsPaneProps {
  org: ProjectOrg | null;
  projectCount: number;
  members: MemberEntry[];
  labels: Label[];
  folderPath: string;
  onFolderPathChange: (value: string) => void;
  onConfigureGitFolder: () => Promise<void>;
  onSyncGitFolder: () => Promise<SyncProjectOrgGitFolderResult | null>;
  onUpdateMembers: (members: MemberEntry[]) => Promise<void>;
  onUpdateLabels: (labels: Label[]) => Promise<void>;
}

export const ProjectOrgSettingsPane: React.FC<ProjectOrgSettingsPaneProps> = ({
  org,
  projectCount,
  members,
  labels,
  folderPath,
  onFolderPathChange,
  onConfigureGitFolder,
  onSyncGitFolder,
  onUpdateMembers,
  onUpdateLabels,
}) => {
  const { t } = useTranslation("projects");
  const [activeTab, setActiveTab] = useState<ProjectOrgSettingsTab>(
    PROJECT_ORG_SETTINGS_TAB.SYNC_METHODS
  );

  const tabs = useMemo<TabPillItem[]>(
    () => [
      {
        key: PROJECT_ORG_SETTINGS_TAB.SYNC_METHODS,
        label: t("orgs.management.syncMethods"),
      },
      { key: PROJECT_ORG_SETTINGS_TAB.MEMBERS, label: t("properties.members") },
      { key: PROJECT_ORG_SETTINGS_TAB.LABELS, label: t("properties.labels") },
    ],
    [t]
  );

  const handleTabChange = useCallback((tab: string) => {
    if (isProjectOrgSettingsTab(tab)) {
      setActiveTab(tab);
    }
  }, []);

  const content = useMemo(() => {
    if (activeTab === PROJECT_ORG_SETTINGS_TAB.MEMBERS) {
      return projectCount > 0 ? (
        <RepoMembersSection
          members={members}
          onUpdateMembers={onUpdateMembers}
          showTitle={false}
        />
      ) : (
        <EmptyOrgCatalogHint />
      );
    }

    if (activeTab === PROJECT_ORG_SETTINGS_TAB.LABELS) {
      return projectCount > 0 ? (
        <LabelsSection
          labels={labels}
          onUpdateLabels={onUpdateLabels}
          showTitle={false}
        />
      ) : (
        <EmptyOrgCatalogHint />
      );
    }

    return (
      <SyncMethodsSection
        org={org}
        folderPath={folderPath}
        onFolderPathChange={onFolderPathChange}
        onConfigure={onConfigureGitFolder}
        onSyncNow={onSyncGitFolder}
      />
    );
  }, [
    activeTab,
    folderPath,
    labels,
    members,
    onConfigureGitFolder,
    onFolderPathChange,
    onSyncGitFolder,
    onUpdateLabels,
    onUpdateMembers,
    org,
    projectCount,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <InternalHeader
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
        tabs={
          <TabPill
            tabs={tabs}
            activeTab={activeTab}
            onChange={handleTabChange}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        }
      />
      <div className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        <div
          className={`${DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop} flex flex-col gap-10`}
        >
          {content}
        </div>
      </div>
    </div>
  );
};

export default ProjectOrgSettingsPane;
