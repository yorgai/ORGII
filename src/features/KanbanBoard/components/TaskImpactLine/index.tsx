import { CircleSlash, Diff, GitCommit, LoaderCircle } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import DiffStatsBadge from "@src/components/DiffStatsBadge";

import type { KanbanTask } from "../../types";
import "./index.scss";

interface TaskImpactLineProps {
  task: KanbanTask;
  className?: string;
  showUnavailable?: boolean;
}

function hasImpactMetadata(task: KanbanTask): boolean {
  return Boolean(
    task.orgtrackMetadata &&
    (task.orgtrackMetadata.filesChanged > 0 ||
      task.orgtrackMetadata.linesAdded > 0 ||
      task.orgtrackMetadata.linesRemoved > 0 ||
      task.orgtrackMetadata.relatedCommits > 0 ||
      task.orgtrackMetadata.committedRatePercent > 0)
  );
}

const TaskImpactLine: React.FC<TaskImpactLineProps> = ({
  task,
  className,
  showUnavailable = true,
}) => {
  const { t } = useTranslation("common");
  const relatedCommits = task.orgtrackMetadata?.relatedCommits ?? 0;
  const hasRelatedCommits = relatedCommits > 0;
  const rootClassName = ["task-impact-line", className]
    .filter(Boolean)
    .join(" ");

  const handleRefreshGitBlame = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    const refresh = task.onAnalyzeGitBlame ?? task.onUpdateGitBlame;
    void refresh?.(task);
  };

  if (hasImpactMetadata(task) && task.orgtrackMetadata) {
    return (
      <span className={rootClassName}>
        <DiffStatsBadge
          additions={task.orgtrackMetadata.linesAdded}
          deletions={task.orgtrackMetadata.linesRemoved}
          variant="plain"
          className="task-impact-line__diff"
          formatValue={(value) => value.toLocaleString()}
        />
        <span className="task-impact-line__dot" />
        <span className="task-impact-line__item">
          <Diff size={12} strokeWidth={1.75} />
          <span>{task.orgtrackMetadata.filesChanged.toLocaleString()}</span>
        </span>
        {hasRelatedCommits && (
          <>
            <span className="task-impact-line__dot" />
            <span className="task-impact-line__item text-primary-6">
              <GitCommit
                className="task-impact-line__commit-icon"
                size={12}
                strokeWidth={1.75}
              />
              <span>{relatedCommits.toLocaleString()}</span>
            </span>
          </>
        )}
      </span>
    );
  }

  if (task.orgtrackMetadataLoading) {
    return (
      <span className={rootClassName}>
        <span className="task-impact-line__loading">
          <LoaderCircle size={12} strokeWidth={1.75} />
          <span>{t("loading")}</span>
        </span>
      </span>
    );
  }

  if (!showUnavailable) return null;

  if (task.onAnalyzeGitBlame || task.onUpdateGitBlame) {
    return (
      <span className={rootClassName}>
        <button
          className="task-impact-line__action"
          type="button"
          title={t("actions.refresh")}
          onClick={handleRefreshGitBlame}
        >
          <CircleSlash size={12} strokeWidth={1.75} />
          <span>N/A</span>
        </button>
      </span>
    );
  }

  return (
    <span className={rootClassName}>
      <span className="task-impact-line__empty">
        <CircleSlash size={12} strokeWidth={1.75} />
        <span>N/A</span>
      </span>
    </span>
  );
};

export default TaskImpactLine;
