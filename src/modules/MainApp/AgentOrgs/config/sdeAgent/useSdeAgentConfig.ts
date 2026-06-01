/**
 * useSdeAgentConfig Hook
 *
 * Manages SDE Agent configuration: loading and saving (debounced).
 * Config is loaded from `.orgii/coding-agent.json` via Tauri commands.
 *
 * Load / debounced-save / undo wiring is provided by useAgentConfigBase.
 */
import { useCallback, useRef } from "react";

import { getAgentConfig, updateAgentConfig } from "@src/api/tauri/agent";
import { RUST_AGENT_TYPE } from "@src/api/tauri/agent/types";

import { useAgentConfigBase } from "../osAgent/useAgentConfigBase";
import { setNested } from "../osAgent/utils";

export interface UseSdeAgentConfigReturn {
  config: Record<string, unknown>;
  loaded: boolean;
  update: (key: string, value: unknown) => void;
}

export function useSdeAgentConfig(
  workspacePath?: string
): UseSdeAgentConfigReturn {
  // Keep latest workspacePath in a ref so the stable load/save callbacks
  // always see the current value without causing dep-array churn.
  const workspacePathRef = useRef(workspacePath);
  workspacePathRef.current = workspacePath;

  const load = useCallback(
    () =>
      getAgentConfig(
        RUST_AGENT_TYPE.SDE,
        workspacePathRef.current ?? ""
      ) as unknown as Promise<Record<string, unknown>>,
    // stable — workspacePath changes are handled via workspacePathRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const save = useCallback(
    (newConfig: Record<string, unknown>) =>
      updateAgentConfig(
        RUST_AGENT_TYPE.SDE,
        newConfig,
        workspacePathRef.current ?? ""
      ),
    // stable — same reasoning as load
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const { config, loaded, updateWithUndo } = useAgentConfigBase({
    load,
    save,
    // Re-fetch when the workspace path changes
    loadDeps: [workspacePath],
  });

  // Update a single key (supports dotted paths like "security.autonomy")
  // and save. Uses setNested so dot paths produce nested objects rather
  // than literal "security.autonomy" top-level keys.
  const update = useCallback(
    (key: string, value: unknown) => {
      const newConfig = key.includes(".")
        ? setNested(config, key, value)
        : { ...config, [key]: value };
      updateWithUndo(newConfig);
    },
    [config, updateWithUndo]
  );

  return { config, loaded, update };
}
