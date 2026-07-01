import { ChevronDown, ChevronRight, Folder, Trash2 } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GitWorktreeDiffSummary } from "@src/api/http/git/types";
import DiffStatsBadge from "@src/components/DiffStatsBadge";
import Dropdown from "@src/components/Dropdown";
import DropdownSelectedCheck from "@src/components/Dropdown/DropdownSelectedCheck";
import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";

import {
  type ScopePickerWorktreeEntry,
  type SourceControlScope,
  diffStatsFromSummary,
  formatScopePickerPath,
  resolveScopeBranchLabel,
  resolveScopeBreadcrumbSegments,
  sortWorktreesByDiffActivity,
  worktreeFolderName,
} from "./sourceControlScopePickerHelpers";

export type { SourceControlScope } from "./sourceControlScopePickerHelpers";

const BREADCRUMB_TONE_CLASS = {
  muted: "text-[11px] text-text-3",
  primary: "text-[12px] font-medium text-text-1",
  secondary: "text-[11px] text-text-2",
} as const;

function ScopePickerDiffStats({
  summary,
}: {
  summary?: GitWorktreeDiffSummary | null;
}) {
  const stats = diffStatsFromSummary(summary);
  if (!stats) return null;

  return (
    <DiffStatsBadge
      additions={stats.additions}
      deletions={stats.deletions}
      variant="plain"
      size="xs"
      className="shrink-0"
    />
  );
}

function ScopePickerItem({
  name,
  path,
  summary,
  selected,
  onSelect,
  onRemove,
  removeLabel,
}: {
  name: string;
  path: string;
  summary?: GitWorktreeDiffSummary | null;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
  removeLabel: string;
}) {
  return (
    <div className={`${DROPDOWN_CLASSES.item} w-full gap-2`}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2"
        onClick={onSelect}
      >
        <Folder size={14} className="shrink-0 text-text-3" />
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate">{name}</span>
          <span className="block truncate text-[11px] text-text-4" title={path}>
            {formatScopePickerPath(path)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <ScopePickerDiffStats summary={summary} />
          {selected && <DropdownSelectedCheck />}
        </span>
      </button>
      {onRemove ? (
        <button
          type="button"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-3 transition-colors hover:bg-danger-1 hover:text-danger-6"
          title={removeLabel}
          aria-label={removeLabel}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={13} />
        </button>
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

  const sortedWorktrees = useMemo(
    () => sortWorktreesByDiffActivity(worktrees),
    [worktrees]
  );

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

  const selectScope = useCallback(
    (nextScope: SourceControlScope) => {
      onScopeChange(nextScope);
      setOpen(false);
    },
    [onScopeChange]
  );

  const droplist = (
    <div className={`${DROPDOWN_CLASSES.panel} w-[400px] p-1`}>
      <div className={DROPDOWN_CLASSES.itemsColumn}>
        <ScopePickerItem
          name={repoName}
          path={repoPath}
          summary={localDiffSummary}
          selected={scope.kind === "local"}
          onSelect={() => selectScope({ kind: "local" })}
          removeLabel={t("sourceControl.removeWorktree")}
        />
        {sortedWorktrees.map((worktree) => (
          <ScopePickerItem
            key={worktree.path}
            name={worktreeFolderName(worktree.path)}
            path={worktree.path}
            summary={worktree.diff_summary}
            selected={scope.kind === "worktree" && scope.path === worktree.path}
            onSelect={() =>
              selectScope({ kind: "worktree", path: worktree.path })
            }
            onRemove={
              onRemoveWorktree ? () => onRemoveWorktree(worktree) : undefined
            }
            removeLabel={t("sourceControl.removeWorktree")}
          />
        ))}
      </div>
    </div>
  );

  return (
    <Dropdown
      droplist={droplist}
      popupVisible={open}
      onVisibleChange={setOpen}
      trigger="click"
      position="bottom-start"
      getPopupContainer={() => document.body}
      avoidViewportOverflow
    >
      <button
        type="button"
        className="flex h-7 min-w-0 max-w-[min(100%,32rem)] items-center gap-1.5 truncate rounded px-1.5 text-left transition-colors hover:bg-fill-2"
        title={`${formatScopePickerPath(activeScopePath)} · ${activeBranch}`}
        aria-label={t("sourceControl.scope.switchScope")}
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
