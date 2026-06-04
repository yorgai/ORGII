/**
 * WorkItemsOverview Component
 *
 * Overview tab content for the Work Items page.
 * Displays project editor (title + description), stats, and recent activity.
 */
import { CheckCircle2, Clock, Layers, TrendingUp } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import Avatar from "@src/components/Avatar";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
} from "@src/components/SettingsTable";
import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";
import StatCard from "@src/modules/MainApp/DevRecord/components/StatCard";
import { getWorkItemStatusConfig } from "@src/modules/ProjectManager/config/manage";
import {
  type LinkedRepoOption,
  PROJECT_PROPERTY_CONCISE_FIELDS,
  ProjectContentEditor,
  type ProjectData,
  ProjectPropertyFields,
} from "@src/modules/ProjectManager/shared";
import {
  CollapsibleSection,
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  STAT_GRID_TOKENS,
} from "@src/modules/shared/layouts/blocks";
import InternalHeader from "@src/modules/shared/layouts/blocks/InternalHeader";
import type { Label, Person, Team } from "@src/types/core/shared";
import type { WorkItem as WorkItemExtended } from "@src/types/core/workItem";

const OVERVIEW_TAB_KEYS = ["description", "stats", "recentChanges"] as const;
type OverviewTab = (typeof OVERVIEW_TAB_KEYS)[number];

// ============================================
// Types
// ============================================

/** Pre-computed stats from Rust (avoid JS recomputation) */
export interface OverviewStats {
  total: number;
  inProgress: number;
  completed: number;
  completionRate: number;
}

export interface WorkItemsOverviewProps {
  /**
   * @deprecated Use precomputedStats instead. Kept for backward compatibility.
   * Work items array for computing stats (fallback if precomputedStats not provided).
   */
  workItems: WorkItemExtended[];
  /** Project name */
  projectName: string;
  /** Project summary (one-liner) */
  projectSummary?: string;
  /** Project description markdown */
  projectDescription?: string;
  /** Project team members from settings */
  availableMembers?: Person[];
  availableTeams?: Team[];
  availableLabels?: Label[];
  availableRepos?: LinkedRepoOption[];
  projectProperties?: ProjectData;
  onProjectPropertiesChange?: (updates: Partial<ProjectData>) => void;
  /**
   * Pre-computed stats from Rust (preferred).
   * If provided, workItems is only used for recent changes list.
   */
  precomputedStats?: OverviewStats;
  /** Project name change handler */
  onProjectNameChange?: (name: string) => void;
  /** Project summary change handler */
  onProjectSummaryChange?: (summary: string) => void;
  /** Project description change handler */
  onProjectDescriptionChange?: (html: string, text: string) => void;
  /** Workspace path used by editor context menus. */
  repoPath?: string | null;
  /** Optional actions rendered beside the title. */
  headerActions?: React.ReactNode;
  /** Additional className */
  className?: string;
}

// ============================================
// Component
// ============================================

const WorkItemsOverview: React.FC<WorkItemsOverviewProps> = ({
  workItems,
  projectName,
  projectSummary,
  projectDescription,
  availableMembers = [],
  availableTeams = [],
  availableLabels = [],
  availableRepos = [],
  projectProperties,
  onProjectPropertiesChange,
  precomputedStats,
  onProjectNameChange,
  onProjectSummaryChange,
  onProjectDescriptionChange,
  repoPath,
  headerActions,
  className = "",
}) => {
  const { t } = useTranslation("projects");
  const [activeTab, setActiveTab] = useState<OverviewTab>("description");
  const [localProjectName, setLocalProjectName] = useState(projectName);
  const propertiesRef = useRef<HTMLElement>(null);

  const tabItems: TabPillItem[] = useMemo(
    () =>
      OVERVIEW_TAB_KEYS.map((key) => ({
        key,
        label: t(`common:labels.${key}`),
      })),
    [t]
  );

  useEffect(() => {
    setLocalProjectName(projectName);
  }, [projectName]);

  const handleProjectNameChange = (name: string) => {
    setLocalProjectName(name);
    onProjectNameChange?.(name);
  };

  const handleDescriptionChange = useCallback(
    (markdown: string, text: string) => {
      onProjectDescriptionChange?.(markdown, text);
    },
    [onProjectDescriptionChange]
  );

  // Use precomputed stats from Rust if available (avoids JS recomputation)
  const stats = useMemo(() => {
    if (precomputedStats) {
      return precomputedStats;
    }
    // Fallback: compute from workItems array (legacy path)
    const total = workItems.length;
    const inProgress = workItems.filter(
      (item) => item.workItemStatus === "in_progress"
    ).length;
    const completed = workItems.filter(
      (item) => item.workItemStatus === "completed"
    ).length;
    const completionRate =
      total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, inProgress, completed, completionRate };
  }, [precomputedStats, workItems]);

  const recentItems = useMemo(() => {
    return [...workItems]
      .sort(
        (itemA, itemB) =>
          new Date(itemB.updated_time).getTime() -
          new Date(itemA.updated_time).getTime()
      )
      .slice(0, 10);
  }, [workItems]);

  const memberNameMap = useMemo(() => {
    const map = new Map<string, Person>();
    for (const member of availableMembers) {
      map.set(member.id, member);
    }
    return map;
  }, [availableMembers]);

  const recentColumns = useMemo<SettingsTableColumn<WorkItemExtended>[]>(
    () => [
      {
        key: "name",
        label: t("workItems.overview.name"),
        width: SETTINGS_TABLE_COL.fill,
        renderCell: (row) => (
          <span className={`${SETTINGS_TABLE_CELL.primary} truncate`}>
            {row.name}
          </span>
        ),
      },
      {
        key: "status",
        label: t("common:common.status"),
        width: SETTINGS_TABLE_COL.valueSm,
        sorter: (rowA, rowB) => {
          const order: Record<string, number> = {
            in_progress: 0,
            in_review: 1,
            planned: 2,
            backlog: 3,
            completed: 4,
            cancelled: 5,
          };
          const statusA = rowA.workItemStatus ?? "backlog";
          const statusB = rowB.workItemStatus ?? "backlog";
          return (order[statusA] ?? 6) - (order[statusB] ?? 6);
        },
        renderCell: (row) => {
          const config = row.workItemStatus
            ? getWorkItemStatusConfig(row.workItemStatus)
            : null;
          if (!config) return null;
          return (
            <span
              className="flex items-center gap-1 whitespace-nowrap text-[12px]"
              style={{ color: config.color }}
            >
              {config.icon}
              <span>{t(`workItems.statusLabels.${row.workItemStatus}`)}</span>
            </span>
          );
        },
      },
      {
        key: "assignee",
        label: t("workItems.overview.assignee"),
        width: SETTINGS_TABLE_COL.valueSm,
        hideBelow: "sm",
        renderCell: (row) => {
          if (!row.assignee) {
            return <span className={SETTINGS_TABLE_CELL.muted}>—</span>;
          }
          const resolved = memberNameMap.get(row.assignee.id) ?? row.assignee;
          return (
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <Avatar
                size={18}
                style={{
                  backgroundColor: resolved.color || "var(--color-fill-3)",
                  color: "var(--color-text-white)",
                  fontSize: "10px",
                }}
              >
                {resolved.name.charAt(0).toUpperCase()}
              </Avatar>
              <span className={SETTINGS_TABLE_CELL.muted}>{resolved.name}</span>
            </span>
          );
        },
      },
      {
        key: "updated",
        label: t("workItems.overview.lastUpdated"),
        width: SETTINGS_TABLE_COL.valueMd,
        align: "right" as const,
        sorter: (rowA: WorkItemExtended, rowB: WorkItemExtended) =>
          new Date(rowA.updated_time).getTime() -
          new Date(rowB.updated_time).getTime(),
        renderCell: (row) => (
          <span
            className={`${SETTINGS_TABLE_CELL.muted} whitespace-nowrap tabular-nums`}
          >
            {new Date(row.updated_time).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        ),
      },
    ],
    [t, memberNameMap]
  );

  return (
    <DetailPanelContainer
      className={className || undefined}
      testId="work-items-overview"
    >
      <div className="shrink-0 px-3 pt-4">
        <ProjectContentEditor
          title={localProjectName}
          onTitleChange={handleProjectNameChange}
          summary={projectSummary}
          onSummaryChange={onProjectSummaryChange}
          initialDescription={projectDescription ?? ""}
          onDescriptionChange={handleDescriptionChange}
          titlePlaceholder={t("workItems.overview.projectNamePlaceholder")}
          descriptionPlaceholder={t(
            "workItems.overview.descriptionPlaceholder"
          )}
          editable={!!onProjectNameChange}
          repoPath={repoPath}
          titleActions={headerActions}
          metaContent={
            projectProperties ? (
              <div className="[&_[data-property-dropdown]]:!top-full [&_[data-property-dropdown]]:!mt-1">
                <ProjectPropertyFields
                  project={projectProperties}
                  onUpdate={onProjectPropertiesChange}
                  availableMembers={availableMembers}
                  availableTeams={availableTeams}
                  availableLabels={availableLabels}
                  availableRepos={availableRepos}
                  containerRef={propertiesRef}
                  fieldVariant="pill"
                  visibleFields={PROJECT_PROPERTY_CONCISE_FIELDS}
                  showMoreMenu
                />
              </div>
            ) : undefined
          }
          descriptionVisible={false}
          className="flex flex-col"
        />
      </div>

      {/* Tab header */}
      <InternalHeader
        compactPadding
        className="pt-4"
        tabs={
          <TabPill
            tabs={tabItems}
            activeTab={activeTab}
            onChange={(key) => setActiveTab(key as OverviewTab)}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        }
      />

      {/* Tab content — scrollable */}
      <div className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        {activeTab === "description" && (
          <div className={DETAIL_PANEL_TOKENS.sectionGap}>
            <ProjectContentEditor
              title={localProjectName}
              onTitleChange={handleProjectNameChange}
              initialDescription={projectDescription ?? ""}
              onDescriptionChange={handleDescriptionChange}
              titlePlaceholder={t("workItems.overview.projectNamePlaceholder")}
              descriptionPlaceholder={t(
                "workItems.overview.descriptionPlaceholder"
              )}
              editable={!!onProjectDescriptionChange}
              titleVisible={false}
              separatorVisible={false}
              descriptionClassName="no-bottom-border"
              repoPath={repoPath}
            />
          </div>
        )}

        {activeTab === "stats" && (
          <>
            {/* Stats */}
            <CollapsibleSection title={t("workItems.overview.stats")}>
              <div className={STAT_GRID_TOKENS.cols4}>
                <StatCard
                  icon={Layers}
                  label={t("workItems.overview.totalItems")}
                >
                  {stats.total}
                </StatCard>
                <StatCard icon={Clock} label={t("common:status.inProgress")}>
                  {stats.inProgress}
                </StatCard>
                <StatCard
                  icon={CheckCircle2}
                  label={t("common:status.completed")}
                >
                  {stats.completed}
                </StatCard>
                <StatCard
                  icon={TrendingUp}
                  label={t("workItems.overview.completionRate")}
                >
                  {stats.completionRate}%
                </StatCard>
              </div>
            </CollapsibleSection>

            {/* Team Members */}
            {availableMembers.length > 0 && (
              <CollapsibleSection title={t("settings.teamMembers")}>
                <div className="flex flex-wrap gap-2">
                  {availableMembers.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center gap-2 rounded-lg bg-fill-2 px-3 py-2"
                    >
                      <Avatar
                        size={20}
                        style={{
                          backgroundColor:
                            member.color || "var(--color-fill-3)",
                          color: "var(--color-text-white)",
                          fontSize: "11px",
                          fontWeight: 600,
                        }}
                      >
                        {member.name.charAt(0).toUpperCase()}
                      </Avatar>
                      <span className="text-[13px] text-text-1">
                        {member.name}
                      </span>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}
          </>
        )}

        {activeTab === "recentChanges" && recentItems.length > 0 && (
          <SettingsTable<WorkItemExtended>
            columns={recentColumns}
            rows={recentItems}
            getRowKey={(row) => row.session_id}
            headerHeight="tall"
            pageSize={50}
            className=""
          />
        )}
      </div>
    </DetailPanelContainer>
  );
};

export default WorkItemsOverview;
