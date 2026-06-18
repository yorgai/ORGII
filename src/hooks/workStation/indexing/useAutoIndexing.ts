import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import {
  CODE_MAP_STATUS,
  getCodeMapStatus,
  startCodeMapIndex,
} from "@src/api/tauri/codeMap";
import { createLogger } from "@src/hooks/logger";
import { autoIndexingEnabledAtom } from "@src/store/search/codeSearchIndexAtom";

const log = createLogger("useAutoIndexing");

export interface UseAutoIndexingOptions {
  /** Absolute path of the workspace to auto-index. */
  workspacePath?: string | null;
  enabled?: boolean;
}

/**
 * Kick off a one-shot code-map index when a workspace is opened and its index
 * is missing or stale. Previously a no-op stub, which meant the built-in code
 * map never populated unless the user manually clicked "Index" in a buried
 * panel — making the feature feel unusable. Gated behind `autoIndexingEnabledAtom`.
 *
 * The Rust code-map engine indexes any path (it does NOT require a git repo),
 * so this works for plain folder workspaces too.
 */
export function useAutoIndexing({
  workspacePath,
  enabled = true,
}: UseAutoIndexingOptions): void {
  const autoIndexingEnabled = useAtomValue(autoIndexingEnabledAtom);
  // Track paths we've already triggered this session so a re-render or status
  // event doesn't re-fire indexing for the same workspace.
  const triggeredPaths = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !autoIndexingEnabled || !workspacePath) return;
    const path = workspacePath;
    if (triggeredPaths.current.has(path)) return;

    let cancelled = false;
    (async () => {
      try {
        const status = await getCodeMapStatus(path);
        if (cancelled) return;
        const needsIndex =
          status.status === CODE_MAP_STATUS.NOT_INDEXED ||
          status.status === CODE_MAP_STATUS.STALE;
        if (!needsIndex) return;
        if (triggeredPaths.current.has(path)) return;
        triggeredPaths.current.add(path);
        log.info(`Auto-indexing code map for workspace: ${path}`);
        await startCodeMapIndex(path, false);
      } catch (err) {
        // Auto-indexing is best-effort; never surface as a user-facing error.
        log.warn(`Auto-index skipped for ${path}:`, err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, autoIndexingEnabled, workspacePath]);
}

export default useAutoIndexing;
