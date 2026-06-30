import type { GitWorktreeDiffSummary } from "@src/api/http/git/types";

interface WorktreeDiffSummaryBadgeProps {
  summary?: GitWorktreeDiffSummary | null;
}

export const WorktreeDiffSummaryBadge: React.FC<
  WorktreeDiffSummaryBadgeProps
> = ({ summary }) => {
  if (!summary || summary.total_files <= 0) return null;

  return (
    <span className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-fill-2 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-text-3">
      <span>{summary.total_files}</span>
      {summary.total_additions > 0 && (
        <span className="text-green-500">+{summary.total_additions}</span>
      )}
      {summary.total_deletions > 0 && (
        <span className="text-red-500">-{summary.total_deletions}</span>
      )}
    </span>
  );
};

export default WorktreeDiffSummaryBadge;
