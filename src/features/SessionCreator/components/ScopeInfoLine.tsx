/**
 * ScopeInfoLine Component
 *
 * Displays workflow scope configuration with inline selectors:
 * "Applicable scope: [Category] : [Scope selection]"
 *
 * Categories: Repo | Session | Projects | Work items
 * Scope varies based on category (multi-select supported)
 */
import InlineDropdown from "@/src/modules/MainApp/AgentOrgs/components/InlineDropdown";
import type { DropdownOption } from "@/src/modules/MainApp/AgentOrgs/types/workflow";
import { Box, Folder, GitBranch, Layers } from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

// ============================================
// Type Definitions
// ============================================

export type ScopeCategory = "repo" | "session" | "project" | "workitem";

export interface ScopeSelection {
  category: ScopeCategory;
  // For repo scope
  repoIds?: string[];
  // For session scope
  sessionIds?: string[];
  sessionRepoFilter?: string; // "all" or specific repo id
  // For project scope
  projectIds?: string[];
  // For work item scope
  workItemIds?: string[];
  workItemProjectFilter?: string; // "all" or specific project id
}

export interface ScopeInfoLineProps {
  /** Current scope selection */
  scope: ScopeSelection;
  /** Handler for scope change */
  onScopeChange: (scope: ScopeSelection) => void;
  /** Available repos (for display) */
  repos?: Array<{ id: string; name: string }>;
  /** Available sessions (for display) */
  sessions?: Array<{ id: string; name: string; repoId?: string }>;
  /** Available projects (for display) */
  projects?: Array<{ id: string; name: string }>;
  /** Available work items (for display) */
  workItems?: Array<{ id: string; name: string; projectId?: string }>;
}

// Category options
const CATEGORY_OPTION_KEYS = [
  { value: "repo" as const, i18nKey: "scope.categories.repo", icon: Folder },
  {
    value: "session" as const,
    i18nKey: "scope.categories.session",
    icon: GitBranch,
  },
  {
    value: "project" as const,
    i18nKey: "scope.categories.projects",
    icon: Box,
  },
  {
    value: "workitem" as const,
    i18nKey: "scope.categories.workItems",
    icon: Layers,
  },
];

// ============================================
// Component
// ============================================

const ScopeInfoLine: React.FC<ScopeInfoLineProps> = ({
  scope,
  onScopeChange,
  repos = [],
  sessions = [],
  projects = [],
  workItems = [],
}) => {
  const { t } = useTranslation("sessions");
  // ============================================
  // Handlers
  // ============================================

  const handleCategoryChange = useCallback(
    (value: string) => {
      const category = value as ScopeCategory;
      // Reset scope when category changes
      onScopeChange({
        category,
        repoIds: category === "repo" ? [] : undefined,
        sessionIds: category === "session" ? [] : undefined,
        sessionRepoFilter: category === "session" ? "all" : undefined,
        projectIds: category === "project" ? [] : undefined,
        workItemIds: category === "workitem" ? [] : undefined,
        workItemProjectFilter: category === "workitem" ? "all" : undefined,
      });
    },
    [onScopeChange]
  );

  const handleScopeSelect = useCallback(
    (value: string) => {
      switch (scope.category) {
        case "repo":
          onScopeChange({
            ...scope,
            repoIds: value === "all" ? [] : [value],
          });
          break;
        case "session":
          onScopeChange({
            ...scope,
            sessionIds: value === "all" ? [] : [value],
          });
          break;
        case "project":
          onScopeChange({
            ...scope,
            projectIds: value === "all" ? [] : [value],
          });
          break;
        case "workitem":
          onScopeChange({
            ...scope,
            workItemIds: value === "all" ? [] : [value],
          });
          break;
      }
    },
    [scope, onScopeChange]
  );

  // ============================================
  // Display Logic
  // ============================================

  // Convert category options to dropdown format
  const categoryDropdownOptions: DropdownOption[] = CATEGORY_OPTION_KEYS.map(
    (opt) => ({
      value: opt.value,
      label: t(opt.i18nKey),
      icon: opt.icon as React.ComponentType<{
        size?: number;
        className?: string;
      }>,
    })
  );

  // Get dropdown options based on category
  const scopeDropdownOptions: DropdownOption[] = useMemo(() => {
    switch (scope.category) {
      case "repo":
        return [
          { value: "all", label: t("scope.allRepos"), icon: undefined },
          ...repos.map((repo) => ({
            value: repo.id,
            label: repo.name,
            icon: Folder as React.ComponentType<{
              size?: number;
              className?: string;
            }>,
          })),
        ];
      case "session":
        return [
          { value: "all", label: t("scope.allSessions"), icon: undefined },
          ...sessions.map((session) => ({
            value: session.id,
            label: session.name,
            icon: GitBranch as React.ComponentType<{
              size?: number;
              className?: string;
            }>,
          })),
        ];
      case "project":
        return [
          { value: "all", label: t("scope.allProjects"), icon: undefined },
          ...projects.map((project) => ({
            value: project.id,
            label: project.name,
            icon: Box as React.ComponentType<{
              size?: number;
              className?: string;
            }>,
          })),
        ];
      case "workitem":
        return [
          { value: "all", label: t("scope.allWorkItems"), icon: undefined },
          ...workItems.map((item) => ({
            value: item.id,
            label: item.name,
            icon: Layers as React.ComponentType<{
              size?: number;
              className?: string;
            }>,
          })),
        ];
      default:
        return [
          { value: "all", label: t("common:actions.all"), icon: undefined },
        ];
    }
  }, [scope.category, repos, sessions, projects, workItems, t]);

  // Get current scope value
  const currentScopeValue = useMemo(() => {
    switch (scope.category) {
      case "repo":
        return scope.repoIds && scope.repoIds.length > 0
          ? scope.repoIds[0]
          : "all";
      case "session":
        return scope.sessionIds && scope.sessionIds.length > 0
          ? scope.sessionIds[0]
          : "all";
      case "project":
        return scope.projectIds && scope.projectIds.length > 0
          ? scope.projectIds[0]
          : "all";
      case "workitem":
        return scope.workItemIds && scope.workItemIds.length > 0
          ? scope.workItemIds[0]
          : "all";
      default:
        return "all";
    }
  }, [scope]);

  // ============================================
  // Render
  // ============================================

  return (
    <div className="flex items-center gap-1 text-[14px] text-text-1">
      <span>{t("scope.applicableScope")}</span>

      {/* Category Selector - InlineDropdown */}
      <InlineDropdown
        value={scope.category}
        onChange={handleCategoryChange}
        options={categoryDropdownOptions}
        placeholder={t("scope.selectCategory")}
        bgVariant="fill-2"
      />

      <span> {t("scope.for")}</span>

      {/* Scope Selector - InlineDropdown with search */}
      <InlineDropdown
        value={currentScopeValue}
        onChange={handleScopeSelect}
        options={scopeDropdownOptions}
        placeholder={t("scope.selectScope")}
        bgVariant="fill-2"
        showSearch
      />

      <span>.</span>
    </div>
  );
};

export default ScopeInfoLine;
