import React, { useMemo } from "react";

import type { CommitDiffResult } from "@src/api/http/git/types";
import { FileHeader } from "@src/modules/WorkStation/shared";
import { DIFF_STATS } from "@src/modules/WorkStation/shared/tokens";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

interface CommitTabHeaderProps {
  shortSha: string;
  commitMessage: string;
  commitDiff: CommitDiffResult | null;
  publishToWorkstationHeader: boolean;
}

/**
 * Renders the commit breadcrumb (shortSha › message [author + stats]) either
 * inline as a 40px file bar or in the global Workstation tab-header strip.
 */
export const CommitTabHeader: React.FC<CommitTabHeaderProps> = ({
  shortSha,
  commitMessage,
  commitDiff,
  publishToWorkstationHeader,
}) => {
  const extraActions = useMemo(
    () =>
      commitDiff?.author || commitDiff?.stats ? (
        <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
          {commitDiff?.author && (
            <span className="flex-shrink-0 text-[12px] text-text-2">
              {commitDiff.author.name}
            </span>
          )}
          {commitDiff?.author?.date && (
            <span className="flex-shrink-0 text-[12px] text-text-3">
              {formatRelativeTime(commitDiff.author.date, "nano")}
            </span>
          )}
          {commitDiff?.stats && (
            <span className={DIFF_STATS.container}>
              <span className={DIFF_STATS.additions}>
                +{commitDiff.stats.insertions}
              </span>
              <span className={DIFF_STATS.deletions}>
                -{commitDiff.stats.deletions}
              </span>
            </span>
          )}
        </div>
      ) : null,
    [commitDiff]
  );

  return (
    <FileHeader
      filePath={`${shortSha}/${commitMessage}`}
      useFileTypeIcon={false}
      disableNavigation
      plainTitle={false}
      extraActions={extraActions}
      publishToHost={publishToWorkstationHeader ? "code" : undefined}
    />
  );
};
