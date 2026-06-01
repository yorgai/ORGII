/**
 * useAvailableShells
 *
 * Fetches detected shells from the Rust backend via `detect_available_shells`
 * and converts them into `ShellProfile` objects for the profile picker.
 *
 * Results are cached after the first successful fetch — the set of available
 * shells doesn't change during a single app session.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { DetectedShell, ShellProfile } from "@src/types/terminal";
import { invokeTauri, isTauriReady } from "@src/util/platform/tauri/init";

interface UseAvailableShellsReturn {
  profiles: ShellProfile[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

let cachedProfiles: ShellProfile[] | null = null;

function detectedShellToProfile(shell: DetectedShell): ShellProfile {
  return {
    id: `${shell.kind}-${shell.path.replace(/[^a-zA-Z0-9]/g, "-")}`,
    name: shell.name,
    path: shell.path,
    args: shell.default_args,
    kind: shell.kind,
    category: shell.category,
    isDefault: shell.is_default,
    isCustom: false,
  };
}

export function useAvailableShells(): UseAvailableShellsReturn {
  const [profiles, setProfiles] = useState<ShellProfile[]>(
    cachedProfiles ?? []
  );
  const [loading, setLoading] = useState(cachedProfiles === null);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(cachedProfiles !== null);

  const fetchShells = useCallback(async () => {
    if (!isTauriReady()) return;

    setLoading(true);
    setError(null);

    try {
      const detected = await invokeTauri<DetectedShell[]>(
        "detect_available_shells"
      );
      const mapped = detected.map(detectedShellToProfile);
      cachedProfiles = mapped;
      setProfiles(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchShells();
    }
  }, [fetchShells]);

  const refresh = useCallback(() => {
    cachedProfiles = null;
    fetchShells();
  }, [fetchShells]);

  return { profiles, loading, error, refresh };
}
