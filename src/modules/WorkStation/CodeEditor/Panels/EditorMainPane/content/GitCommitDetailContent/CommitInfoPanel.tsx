import React from "react";

import type { CommitDiffResult } from "@src/api/http/git/types";
import { DIFF_STATS } from "@src/modules/WorkStation/shared/tokens";

interface CommitInfoPanelProps {
  commitDiff: CommitDiffResult;
}

/**
 * The fixed-height info strip rendered below the file list / diff header:
 * shows commit body and overall stats.
 */
export const CommitInfoPanel: React.FC<CommitInfoPanelProps> = ({
  commitDiff,
}) => {
  return (
    <div className="flex max-h-40 flex-shrink-0 flex-col border-b border-border-2 px-4 py-3">
      <div className="flex min-h-0 min-w-0 flex-1 items-start justify-between gap-3 overflow-hidden">
        {commitDiff.body ? (
          <div className="min-h-0 flex-1 overflow-y-auto pr-2 scrollbar-hide">
            <p className="max-w-[860px] whitespace-pre-wrap text-[12px] leading-5 text-text-2">
              {commitDiff.body}
            </p>
          </div>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        {commitDiff.stats && (
          <span className={`${DIFF_STATS.container} flex-shrink-0`}>
            <span className={DIFF_STATS.additions}>
              +{commitDiff.stats.insertions}
            </span>
            <span className={DIFF_STATS.deletions}>
              -{commitDiff.stats.deletions}
            </span>
          </span>
        )}
      </div>
    </div>
  );
};
