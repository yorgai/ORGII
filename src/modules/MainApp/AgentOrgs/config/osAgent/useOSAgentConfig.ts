/**
 * useOSAgentConfig Hook
 *
 * Manages OS Agent configuration: loading, saving (debounced),
 * and credential checking.
 *
 * Load / debounced-save / undo wiring is provided by useAgentConfigBase.
 * This hook adds OS-specific credential checking.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  checkKeys,
  getAgentConfig,
  updateAgentConfig,
} from "@src/api/tauri/agent";
import { RUST_AGENT_TYPE } from "@src/api/tauri/agent/types";

import type { CredentialStatus } from "./types";
import { useAgentConfigBase } from "./useAgentConfigBase";
import { getNestedString, setNested } from "./utils";

export interface UseOSAgentConfigReturn {
  config: Record<string, unknown>;
  loaded: boolean;
  credStatus: CredentialStatus | null;
  update: (path: string, value: unknown) => void;
  /** Replace the entire config object (for operations like deleteNested) */
  rawUpdate: (newConfig: Record<string, unknown>) => void;
}

export function useOSAgentConfig(): UseOSAgentConfigReturn {
  const [credStatus, setCredStatus] = useState<CredentialStatus | null>(null);
  const credCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedCheckCredentials = useCallback((model: string) => {
    if (credCheckTimerRef.current) clearTimeout(credCheckTimerRef.current);
    credCheckTimerRef.current = setTimeout(() => {
      if (!model) {
        setCredStatus(null);
        return;
      }
      checkKeys(model)
        .then((status) => setCredStatus(status as unknown as CredentialStatus))
        .catch((err) => {
          console.warn("[OSAgent] credential check failed:", err);
          setCredStatus(null);
        });
    }, 300);
  }, []);

  // Cleanup cred-check timer on unmount
  useEffect(() => {
    return () => {
      if (credCheckTimerRef.current) clearTimeout(credCheckTimerRef.current);
    };
  }, []);

  const { config, loaded, saveConfig, updateWithUndo } = useAgentConfigBase({
    load: () =>
      getAgentConfig(RUST_AGENT_TYPE.OS).then(
        (parsed) => parsed as unknown as Record<string, unknown>
      ),
    save: (newConfig) => updateAgentConfig(RUST_AGENT_TYPE.OS, newConfig),
    onRestore: (prev) => {
      const model = getNestedString(prev, "model", "");
      if (model) debouncedCheckCredentials(model);
    },
  });

  // Check credentials once initial load completes
  useEffect(() => {
    if (loaded) {
      const model = getNestedString(config, "model", "");
      if (model) debouncedCheckCredentials(model);
    }
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(
    (path: string, value: unknown) => {
      updateWithUndo(setNested(config, path, value));
      if (path === "model" && typeof value === "string") {
        debouncedCheckCredentials(value);
      }
    },
    [config, updateWithUndo, debouncedCheckCredentials]
  );

  return { config, loaded, credStatus, update, rawUpdate: saveConfig };
}
