import { useCallback, useEffect, useRef, useState } from "react";

import type { DiffStats } from "@src/api/http/project";
import { invokeTauri } from "@src/util/platform/tauri/init";

const POLL_INTERVAL_MS = 10_000;
const DEFAULT_BASE_BRANCH = "main";

interface UseLiveDiffStatsOptions {
  repoPath?: string | null;
  branch?: string;
  isLive: boolean;
}

export function useLiveDiffStats(options: UseLiveDiffStatsOptions) {
  const { repoPath, branch, isLive } = options;

  const [liveDiffStats, setLiveDiffStats] = useState<DiffStats | null>(null);
  const livePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollDiffStats = useCallback(async () => {
    if (!repoPath || !branch) return;
    try {
      const stats = await invokeTauri<DiffStats>(
        "orchestrator_get_diff_stats",
        { repoPath, baseBranch: DEFAULT_BASE_BRANCH, workItemBranch: branch }
      );
      setLiveDiffStats(stats);
    } catch {
      // git diff may fail if branch doesn't exist yet
    }
  }, [repoPath, branch]);

  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      await pollDiffStats();
      if (!cancelled) {
        livePollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (livePollRef.current) clearTimeout(livePollRef.current);
    };
  }, [isLive, pollDiffStats]);

  return liveDiffStats;
}
