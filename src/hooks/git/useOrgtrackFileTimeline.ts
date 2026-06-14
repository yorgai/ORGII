import { useCallback, useEffect, useState } from "react";

import {
  type OrgtrackFileTimeline,
  getOrgtrackFileTimeline,
} from "@src/api/tauri/lineage";

export interface UseOrgtrackFileTimelineOptions {
  repoPath: string;
  filePath: string | null;
  autoLoad?: boolean;
}

export interface UseOrgtrackFileTimelineResult {
  timeline: OrgtrackFileTimeline | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useOrgtrackFileTimeline({
  repoPath,
  filePath,
  autoLoad = true,
}: UseOrgtrackFileTimelineOptions): UseOrgtrackFileTimelineResult {
  const [timeline, setTimeline] = useState<OrgtrackFileTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!filePath || !repoPath) {
      setTimeline(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setTimeline(await getOrgtrackFileTimeline({ repoPath, filePath }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTimeline(null);
    } finally {
      setLoading(false);
    }
  }, [filePath, repoPath]);

  useEffect(() => {
    if (autoLoad) {
      void refresh();
    }
  }, [autoLoad, refresh]);

  return { timeline, loading, error, refresh };
}
