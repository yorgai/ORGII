/**
 * IssuesContent
 *
 * GitHub Issues panel for the workstation primary sidebar.
 * Interaction patterns aligned with SourceControlContent:
 * - "Filter issues…" input (same style as "Filter changes…")
 * - Inline status filter + refresh controls below the search input
 * - The outer CollapsibleSection header ("ISSUES") is provided by the sidebar module
 */
import { useSetAtom } from "jotai";
import { CircleDot, ListFilter, RefreshCw, XCircle } from "lucide-react";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import Dropdown from "@src/components/Dropdown";
import { buildIntegrationsPath } from "@src/config/mainAppPaths/integrations";
import {
  HEADER_BUTTON,
  HEADER_ICON_SIZE,
  SECTION_ACTION_BUTTON,
} from "@src/config/workstation/tokens";
import { useWorkStationTabs } from "@src/hooks/workStation/tabs/useWorkStationTabs";
import { SectionFilterInput } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/components/SectionFilterInput";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { workstationIssueCallbackAtom } from "@src/store/workstation/codeEditor/workstationIssueAtom";
import { createGitHubIssueDetailTab } from "@src/store/workstation/tabs";

import { useWorkstationIssues } from "../../hooks/useWorkstationIssues";
import type { IssueFilterState } from "../../hooks/useWorkstationIssues";
import { IssueRow } from "./IssueRow";
import { NewIssueForm } from "./NewIssueForm";

export interface IssuesContentProps {
  repoPath: string;
  repoId?: string;
  branchName?: string;
  remoteUrl?: string;
  onOpenNewIssueForm?: () => void;
  /** Whether the filter input row is currently open */
  showFilter?: boolean;
  /** Active filter query (synced with external useSectionFilter) */
  filterQuery?: string;
  /** Called when filter query changes */
  onFilterQueryChange?: (q: string) => void;
  /** Called when the filter input should close (Escape pressed) */
  onFilterClose?: () => void;
}

const IssuesContent: React.FC<IssuesContentProps> = memo(
  ({
    repoPath,
    repoId,
    branchName,
    remoteUrl,
    showFilter = false,
    filterQuery = "",
    onFilterQueryChange,
    onFilterClose,
  }) => {
    const { t } = useTranslation("common");
    const navigate = useNavigate();
    const setCallbackAtom = useSetAtom(workstationIssueCallbackAtom);
    const { openTab } = useWorkStationTabs();

    const {
      issues,
      loading,
      remoteUrlLoading,
      needsReAuth,
      error,
      filterState,
      setFilterState,
      setSearchQuery,
      selectIssue,
      handleCreateIssue,
      handleCloseIssue,
      handleReopenIssue,
      handleAddComment,
      refresh,
      repoLabels,
      collaborators,
    } = useWorkstationIssues({ repoPath, repoId, branchName, remoteUrl });

    const [showNewIssueForm, setShowNewIssueForm] = useState(false);
    const [creatingIssue, setCreatingIssue] = useState(false);
    const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);

    // Keep internal debounced search in sync with the externally controlled query
    useEffect(() => {
      setSearchQuery(filterQuery);
    }, [filterQuery, setSearchQuery]);

    const handleOpenNewIssueForm = useCallback(() => {
      setShowNewIssueForm(true);
    }, []);

    const handleCancelNewIssue = useCallback(() => {
      setShowNewIssueForm(false);
    }, []);

    const handleSubmitNewIssue = useCallback(
      async (
        title: string,
        body: string,
        labels: string[],
        assignees: string[]
      ) => {
        setCreatingIssue(true);
        try {
          const created = await handleCreateIssue(
            title,
            body || undefined,
            labels,
            assignees
          );
          if (created) {
            setShowNewIssueForm(false);
            selectIssue(created);
            openTab(
              createGitHubIssueDetailTab(
                created.number,
                created.title,
                repoPath
              )
            );
          }
        } finally {
          setCreatingIssue(false);
        }
      },
      [handleCreateIssue, selectIssue, openTab, repoPath]
    );

    // Register callbacks so PinnedActionsBar, agents, and the github-issue-detail
    // tab renderer can trigger issue actions without coupling to this component.
    useEffect(() => {
      setCallbackAtom({
        openNewIssueForm: handleOpenNewIssueForm,
        closeIssue: handleCloseIssue,
        reopenIssue: handleReopenIssue,
        addComment: (number, body) => handleAddComment(number, body),
      });
      return () => {
        setCallbackAtom({
          openNewIssueForm: null,
          closeIssue: null,
          reopenIssue: null,
          addComment: null,
        });
      };
    }, [
      setCallbackAtom,
      handleOpenNewIssueForm,
      handleCloseIssue,
      handleReopenIssue,
      handleAddComment,
    ]);

    // Show spinner while the remote URL is still being resolved (async) OR
    // while the first page of issues is loading. Without this guard the panel
    // would flash "No open issues" before the async fetch even starts.
    const isInitialLoading =
      remoteUrlLoading || (loading && issues.length === 0);

    // ── Render ────────────────────────────────────────────────────────────────

    // Status filter dropdown options — icon + label per state
    const filterOptions = [
      {
        value: "open" as IssueFilterState,
        label: "Open",
        icon: <CircleDot size={13} strokeWidth={1.75} />,
        color: "text-success-6",
      },
      {
        value: "closed" as IssueFilterState,
        label: "Closed",
        icon: <XCircle size={13} strokeWidth={1.75} />,
        color: "text-text-3",
      },
      {
        value: "all" as IssueFilterState,
        label: "All",
        icon: <ListFilter size={13} strokeWidth={1.75} />,
        color: "text-text-3",
      },
    ];

    const currentFilter = filterOptions.find((f) => f.value === filterState)!;

    const statusDropdown = (
      <Dropdown
        popupVisible={filterDropdownOpen}
        onVisibleChange={setFilterDropdownOpen}
        position="bottom-end"
        droplist={
          <div className="min-w-[110px] py-1">
            {filterOptions.map(({ value, label, icon, color }) => (
              <button
                key={value}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFilterState(value);
                  setFilterDropdownOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-fill-2 ${
                  filterState === value ? "text-text-1" : "text-text-2"
                }`}
              >
                <span className={color}>{icon}</span>
                <span>{label}</span>
                {filterState === value && (
                  <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary-6" />
                )}
              </button>
            ))}
          </div>
        }
      >
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={`${SECTION_ACTION_BUTTON.base} gap-1 px-1.5 py-0.5 text-[11px] font-medium ${
            filterDropdownOpen
              ? "bg-fill-2 text-text-1"
              : "text-text-3 hover:text-text-1"
          }`}
          title={`Filter: ${currentFilter.label}`}
        >
          <span className={currentFilter.color}>{currentFilter.icon}</span>
          <span>{currentFilter.label}</span>
        </button>
      </Dropdown>
    );

    const inlineActions = (
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1">
        {statusDropdown}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            refresh();
          }}
          disabled={loading}
          className={HEADER_BUTTON.actionDisabled}
          title={t("actions.refresh", "Refresh")}
        >
          <RefreshCw
            size={HEADER_ICON_SIZE.sm}
            strokeWidth={2}
            className={loading ? "animate-spin" : undefined}
          />
        </button>
      </div>
    );

    let listContent: React.ReactNode;

    if (isInitialLoading) {
      listContent = (
        <Placeholder
          variant="loading"
          placement="sidebar"
          title={t("placeholders.loadingChanges", "Loading issues…")}
          fillParentHeight
        />
      );
    } else if (needsReAuth) {
      listContent = (
        <Placeholder
          variant="error"
          placement="sidebar"
          title={t(
            "git.issues.reAuthRequired",
            "GitHub Authorization Required"
          )}
          subtitle={t(
            "git.issues.reAuthDescription",
            "Your GitHub token has expired. Go to Settings → Integrations → Git to reconnect."
          )}
          action={{
            label: t("git.issues.goToSettings", "Go to Settings"),
            onClick: () => navigate(buildIntegrationsPath({ category: "git" })),
          }}
          fillParentHeight
        />
      );
    } else if (error) {
      listContent = (
        <Placeholder
          variant="error"
          placement="sidebar"
          title={t("git.issues.failedToLoad", "Failed to load issues")}
          subtitle={error}
          action={{ label: t("actions.retry", "Retry"), onClick: refresh }}
          fillParentHeight
        />
      );
    } else {
      listContent = (
        <div ref={listRef} className="flex flex-1 flex-col overflow-y-auto">
          {inlineActions}
          {issues.length === 0 ? (
            <Placeholder
              variant="empty"
              placement="sidebar"
              title={t("git.issues.empty", "No {{state}} issues", {
                state: filterState,
              })}
            />
          ) : (
            issues.map((issue) => (
              <IssueRow
                key={issue.number}
                issue={issue}
                isSelected={false}
                onClick={() => {
                  selectIssue(issue);
                  openTab(
                    createGitHubIssueDetailTab(
                      issue.number,
                      issue.title,
                      repoPath
                    )
                  );
                }}
              />
            ))
          )}
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {showFilter && (
          <SectionFilterInput
            query={filterQuery}
            onChange={(q) => onFilterQueryChange?.(q)}
            onClose={() => onFilterClose?.()}
            placeholder={t("git.issues.searchPlaceholder", "Filter issues…")}
          />
        )}

        {showNewIssueForm && (
          <NewIssueForm
            onSubmit={handleSubmitNewIssue}
            onCancel={handleCancelNewIssue}
            repoLabels={repoLabels}
            collaborators={collaborators}
            loading={creatingIssue}
          />
        )}

        {listContent}
      </div>
    );
  }
);

IssuesContent.displayName = "IssuesContent";

export default IssuesContent;
