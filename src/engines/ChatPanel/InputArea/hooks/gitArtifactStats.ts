import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  getGitArtifactDedupeKey,
  getGitArtifactsFromEvent,
} from "@src/shared/git/sessionGitArtifacts";

import type { GitArtifactStats } from "./useComposerSections";

export function deriveGitArtifactStats(
  events: readonly SessionEvent[]
): GitArtifactStats {
  const seenKeys = new Set<string>();
  const stats: GitArtifactStats = { commitCount: 0, pullRequestCount: 0 };

  for (const event of events) {
    for (const artifact of getGitArtifactsFromEvent(event)) {
      const key = getGitArtifactDedupeKey(artifact);
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);

      if (artifact.kind === "commit") {
        stats.commitCount += 1;
      } else if (artifact.kind === "pullRequest") {
        stats.pullRequestCount += 1;
      }
    }
  }

  return stats;
}
