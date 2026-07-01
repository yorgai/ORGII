import {
  ChevronDown,
  ChevronRight,
  Folder,
  Search,
  Trash2,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GitWorktreeDiffSummary } from "@src/api/http/git/types";
import DiffStatsBadge from "@src/components/DiffStatsBadge";
import Dropdown from "@src/components/Dropdown";
import DropdownSelectedCheck from "@src/components/Dropdown/DropdownSelectedCheck";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import IconButton from "@src/components/IconButton";
import {
  formatCompactStatNumber,
  formatDiffStatsLabel,
} from "@src/shared/pr/formatStatNumber";

import {
  type ScopePickerWorktreeEntry,
  type SourceControlScope,
  diffStatsFromSummary,
  filterScopePickerWorktrees,
  formatScopeDiffStatsTooltip,
  formatScopePickerPath,
  mainScopeMatchesQuery,
  resolveScopeBranchLabel,
  resolveScopeBreadcrumbSegments,
  shouldShowScopePickerSearch,
  sortWorktreesByDiffActivity,
  worktreeFolderName,
} from "./sourceControlScopePickerHelpers";

export type { SourceControlScope } from "./sourceControlScopePickerHelpers";

const BREADCRUMB_TONE_CLASS = {
  muted: "text-[11px] text-text-3",
  primary: "text-[12px] font-medium text-text-1",
  secondary: "text-[11px] text-text-2",
} as const;

const SCOPE_PICKER_ROW = [
  "group/scope-row flex w-full items-center gap-1",
  "min-h-9 rounded-md px-1.5 py-1",
  DROPDOWN_ITEM.transitionClass,
  DROPDOWN_ITEM.hoverBgClass,
].join(" ");

function ScopePickerDiffStats({
  summary,
}: {
  summary?: GitWorktreeDiffSummary | null;
}) {
  const stats = diffStatsFromSummary(summary);
  if (!stats) return null;

  return (
    <span
      className="shrink-0"
      title={
        summary
          ? formatScopeDiffStatsTooltip(summary)
          : formatDiffStatsLabel(stats.additions, stats.deletions)
      }
    >
      <DiffStatsBadge
        additions={stats.additions}
        deletions={stats.deletions}
        variant="plain"
        size="xs"
        formatValue={formatCompactStatNumber}
        valueClassName="min-w-0"
      />
    </span>
  );
}

function ScopePickerSectionLabel({ label }: { label: string }) {
  return <div className={DROPDOWN_CLASSES.sectionLabel}>{label}</div>;
}

function ScopePickerItem({
  name,
  subtitle,
  path,
  summary,
  selected,
  onSelect,
  onRemove,
  removeLabel,
}: {
  name: string;
  subtitle: string;
  path: string;
  summary?: GitWorktreeDiffSummary | null;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
  removeLabel: string;
}) {
  return (
    <div className={SCOPE_PICKER_ROW}>
      <button
        type="button"
        className={`flex min-w-0 flex-1 items-center gap-2 text-left ${selected ? DROPDOWN_CLASSES.itemSelected : "text-text-1"}`}
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        title={`${formatScopePickerPath(path)} · ${subtitle}`}
      >
        <Folder
          size={DROPDOWN_ITEM.iconSize}
          className="shrink-0 text-text-3"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-tight">
            {name}
          </span>
          {subtitle ? (
            <span className="block truncate text-[11px] leading-tight text-text-3">
              {subtitle}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <ScopePickerDiffStats summary={summary} />
          {selected ? <DropdownSelectedCheck /> : null}
        </span>
      </button>
      {onRemove ? (
        <IconButton
          type="button"
          size="sm"
          variant="danger"
          className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/scope-row:opacity-100"
          title={removeLabel}
          aria-label={removeLabel}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={DROPDOWN_ITEM.iconSize} />
        </IconButton>
      ) : null}
    </div>
  );
}

export interface SourceControlScopeToolbarProps {
  repoName: string;
  branchLabel: string;
  repoPath: string;
  localDiffSummary?: GitWorktreeDiffSummary | null;
  worktrees: ScopePickerWorktreeEntry[];
  scope: SourceControlScope;
  onScopeChange: (scope: SourceControlScope) => void;
  onRemoveWorktree?: (worktree: ScopePickerWorktreeEntry) => void;
}

/** Worktree scope switcher for the main Source Control tab header. */
export function SourceControlScopeToolbar({
  repoName,
  branchLabel,
  repoPath,
  localDiffSummary,
  worktrees,
  scope,
  onScopeChange,
  onRemoveWorktree,
}: SourceControlScopeToolbarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const sortedWorktrees = useMemo(
    () => sortWorktreesByDiffActivity(worktrees),
    [worktrees]
  );
  const filteredWorktrees = useMemo(
    () => filterScopePickerWorktrees(sortedWorktrees, searchQuery),
    [searchQuery, sortedWorktrees]
  );
  const showMainScope = mainScopeMatchesQuery(
    repoName,
    branchLabel,
    repoPath,
    searchQuery
  );
  const showSearch = shouldShowScopePickerSearch(worktrees.length);

  const selectedWorktree =
    scope.kind === "worktree"
      ? worktrees.find((worktree) => worktree.path === scope.path)
      : undefined;
  const activeBranch = resolveScopeBranchLabel(branchLabel, selectedWorktree);
  const activeScopePath = selectedWorktree?.path ?? repoPath;
  const activeDiffSummary = selectedWorktree
    ? selectedWorktree.diff_summary
    : localDiffSummary;
  const breadcrumbSegments = useMemo(
    () =>
      resolveScopeBreadcrumbSegments({
        repoName,
        branchLabel: activeBranch,
        scope,
        selectedWorktreePath: selectedWorktree?.path,
      }),
    [activeBranch, repoName, scope, selectedWorktree?.path]
  );
  const triggerAriaLabel = t("sourceControl.scope.switchScopeActive", {
    repo: repoName,
    branch: activeBranch,
  });

  const handleVisibleChange = useCallback((visible: boolean) => {
    setOpen(visible);
    if (!visible) {
      setSearchQuery("");
    }
  }, []);

  const selectScope = useCallback(
    (nextScope: SourceControlScope) => {
      onScopeChange(nextScope);
      setOpen(false);
      setSearchQuery("");
    },
    [onScopeChange]
  );

  const droplist = (
    <div
      className={`${DROPDOWN_CLASSES.panel} ${DROPDOWN_WIDTHS.fileTreeClass} max-w-[400px] overflow-hidden`}
    >
      {showSearch ? (
        <div className={DROPDOWN_CLASSES.searchContainer}>
          <Search
            size={DROPDOWN_ITEM.iconSize}
            className="shrink-0 text-text-3"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("sourceControl.scope.searchPlaceholder")}
            className={DROPDOWN_CLASSES.searchInput}
            aria-label={t("sourceControl.scope.searchPlaceholder")}
          />
        </div>
      ) : null}
      <div className={DROPDOWN_CLASSES.optionsContainerScrollbar}>
        {showMainScope ? (
          <>
            <ScopePickerSectionLabel label={t("sourceControl.scope.main")} />
            <ScopePickerItem
              name={repoName}
              subtitle={branchLabel}
              path={repoPath}
              summary={localDiffSummary}
              selected={scope.kind === "local"}
              onSelect={() => selectScope({ kind: "local" })}
              removeLabel={t("sourceControl.removeWorktree")}
            />
          </>
        ) : null}
        {filteredWorktrees.length > 0 ? (
          <>
            <ScopePickerSectionLabel
              label={t("sourceControl.scope.worktrees")}
            />
            {filteredWorktrees.map((worktree) => (
              <ScopePickerItem
                key={worktree.path}
                name={worktreeFolderName(worktree.path)}
                subtitle={worktree.branch}
                path={worktree.path}
                summary={worktree.diff_summary}
                selected={
                  scope.kind === "worktree" && scope.path === worktree.path
                }
                onSelect={() =>
                  selectScope({ kind: "worktree", path: worktree.path })
                }
                onRemove={
                  onRemoveWorktree
                    ? () => onRemoveWorktree(worktree)
                    : undefined
                }
                removeLabel={t("sourceControl.removeWorktree")}
              />
            ))}
          </>
        ) : null}
        {!showMainScope && filteredWorktrees.length === 0 ? (
          <div className={DROPDOWN_CLASSES.listMessage}>
            {t("placeholders.noResults", "No results")}
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <Dropdown
      droplist={droplist}
      popupVisible={open}
      onVisibleChange={handleVisibleChange}
      trigger="click"
      position="bottom-start"
      getPopupContainer={() => document.body}
      avoidViewportOverflow
    >
      <button
        type="button"
        className="flex h-7 min-w-0 max-w-[min(100%,32rem)] items-center gap-1.5 truncate rounded px-1.5 text-left transition-colors hover:bg-fill-2"
        title={`${formatScopePickerPath(activeScopePath)} · ${activeBranch}`}
        aria-label={triggerAriaLabel}
      >
        <span className="flex min-w-0 items-center gap-1 truncate">
          {breadcrumbSegments.map((segment, index) => (
            <React.Fragment key={`${segment.label}-${index}`}>
              {index > 0 ? (
                <ChevronRight size={10} className="shrink-0 text-text-4" />
              ) : null}
              <span
                className={`truncate ${segment.tone === "primary" ? "min-w-0" : "shrink-0"} ${BREADCRUMB_TONE_CLASS[segment.tone]}`}
              >
                {segment.label}
              </span>
            </React.Fragment>
          ))}
        </span>
        <ScopePickerDiffStats summary={activeDiffSummary} />
        <ChevronDown size={12} className="shrink-0 text-text-3" />
      </button>
    </Dropdown>
  );
}
