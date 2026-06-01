/**
 * useToolsSharedConfig
 *
 * Shared backbone for every tools table in the app:
 *   - Integrations → Built-in Tools  (`useBuiltInTools`, global view)
 *   - AgentOrgs → OS/SDE agent → Tools tab  (`useAgentTools`, scoped view)
 *
 * Both consumers needed identical logic for:
 *   - loading the OS/SDE per-agent configs (`excludedTools` lists),
 *   - deriving `osDisabled` / `sdeDisabled` Sets,
 *   - toggling a single tool for one agent,
 *   - batch-flipping many tools at once (used by the MCP "source toggle").
 *
 * Extracting the shared slice here keeps that logic in one place — previously
 * the two hooks drifted (for example, the old `useBuiltInTools` even wired its
 * per-agent Switch to call BOTH toggles at once, which is not what a per-agent
 * toggle should do).  Consumers still layer their own state on top:
 *
 *   - `useBuiltInTools` adds: MCP filtering, custom-tool CRUD, preview
 *     selection state, custom simulatorApp/humanToolKey shape.
 *   - `useAgentTools`    adds: per-agent filtering, MCP server grouping
 *     and parent-row batch toggles, preview selection state.
 *
 * The hook itself returns only primitive data + pure callbacks; no selection
 * or search state lives here.
 */
import { useCallback, useMemo } from "react";

import { useOSAgentConfig } from "../../AgentOrgs/config/osAgent/useOSAgentConfig";
import { getNestedStringArray } from "../../AgentOrgs/config/osAgent/utils";
import { useSdeAgentConfig } from "../../AgentOrgs/config/sdeAgent/useSdeAgentConfig";
import type { RawToolInfo } from "./types";
import { useUnifiedToolsMetadata } from "./useUnifiedToolsMetadata";

/**
 * Tools whose name starts with `mcp__<server>__` are dispatched through the
 * MCP bridge and live in `AgentToolSelection.disabled_mcp_tools` on the Rust
 * side; everything else lives in `excluded_tools`. The two lists are
 * intentionally separate (different writers, different consumers — see
 * `init/mcp_wiring.rs` vs `init/mod.rs`). Toggle writes must respect the
 * split or the disable silently no-ops.
 */
const MCP_TOOL_PREFIX = "mcp__";
const MCP_FIELD = "disabledMcpTools";
const EXCLUDED_FIELD = "excludedTools";

function fieldFor(toolName: string): "disabledMcpTools" | "excludedTools" {
  return toolName.startsWith(MCP_TOOL_PREFIX) ? MCP_FIELD : EXCLUDED_FIELD;
}

export interface ToolsSharedConfig {
  // ── raw data from backend ─────────────────────────────────────────────
  rawTools: RawToolInfo[];
  toolsLoading: boolean;
  refreshTools: () => void;

  // ── OS agent slice ───────────────────────────────────────────────────
  osLoaded: boolean;
  osDisabled: Set<string>;
  toggleOS: (toolName: string) => void;
  setOSEnabledBatch: (toolNames: string[], enable: boolean) => void;

  // ── SDE agent slice ──────────────────────────────────────────────────
  sdeLoaded: boolean;
  sdeDisabled: Set<string>;
  toggleSde: (toolName: string) => void;
  setSdeEnabledBatch: (toolNames: string[], enable: boolean) => void;
}

export function useToolsSharedConfig(): ToolsSharedConfig {
  const {
    config: osConfig,
    loaded: osLoaded,
    update: osUpdate,
  } = useOSAgentConfig();
  const {
    config: sdeConfig,
    loaded: sdeLoaded,
    update: sdeUpdate,
  } = useSdeAgentConfig();

  const {
    rawTools,
    loading: toolsLoading,
    refresh: refreshTools,
  } = useUnifiedToolsMetadata();

  const osDisabled = useMemo(
    () =>
      new Set([
        ...getNestedStringArray(osConfig, EXCLUDED_FIELD),
        ...getNestedStringArray(osConfig, MCP_FIELD),
      ]),
    [osConfig]
  );
  const sdeDisabled = useMemo(
    () =>
      new Set([
        ...getNestedStringArray(sdeConfig, EXCLUDED_FIELD),
        ...getNestedStringArray(sdeConfig, MCP_FIELD),
      ]),
    [sdeConfig]
  );

  const toggleOS = useCallback(
    (toolName: string) => {
      const field = fieldFor(toolName);
      const current = getNestedStringArray(osConfig, field);
      const next = current.includes(toolName)
        ? current.filter((name) => name !== toolName)
        : [...current, toolName];
      osUpdate(field, next);
    },
    [osConfig, osUpdate]
  );

  const toggleSde = useCallback(
    (toolName: string) => {
      const field = fieldFor(toolName);
      const current = getNestedStringArray(sdeConfig, field);
      const next = current.includes(toolName)
        ? current.filter((name) => name !== toolName)
        : [...current, toolName];
      sdeUpdate(field, next);
    },
    [sdeConfig, sdeUpdate]
  );

  /**
   * Flip every tool in `toolNames` on or off for the OS agent in a single
   * config write — used by MCP source batch-toggle to avoid one update per
   * child tool. MCP tools (`mcp__server__tool` prefix) are routed to
   * `disabledMcpTools`; everything else to `excludedTools`. We write each
   * field at most once even when the batch contains a mix.
   *
   * `enable=true`  → remove each name from its target field.
   * `enable=false` → add each name to its target field if not already there.
   */
  const setEnabledBatchInternal = useCallback(
    (
      configRecord: Record<string, unknown>,
      updateFn: (path: string, value: unknown) => void,
      toolNames: string[],
      enable: boolean
    ) => {
      if (toolNames.length === 0) return;
      const buckets: Record<"disabledMcpTools" | "excludedTools", string[]> = {
        disabledMcpTools: [],
        excludedTools: [],
      };
      for (const name of toolNames) buckets[fieldFor(name)].push(name);
      for (const field of Object.keys(buckets) as Array<keyof typeof buckets>) {
        const names = buckets[field];
        if (names.length === 0) continue;
        const current = getNestedStringArray(configRecord, field);
        const set = new Set(current);
        if (enable) {
          for (const name of names) set.delete(name);
        } else {
          for (const name of names) set.add(name);
        }
        updateFn(field, Array.from(set));
      }
    },
    []
  );

  const setOSEnabledBatch = useCallback(
    (toolNames: string[], enable: boolean) => {
      setEnabledBatchInternal(osConfig, osUpdate, toolNames, enable);
    },
    [osConfig, osUpdate, setEnabledBatchInternal]
  );

  const setSdeEnabledBatch = useCallback(
    (toolNames: string[], enable: boolean) => {
      setEnabledBatchInternal(sdeConfig, sdeUpdate, toolNames, enable);
    },
    [sdeConfig, sdeUpdate, setEnabledBatchInternal]
  );

  return {
    rawTools,
    toolsLoading,
    refreshTools,
    osLoaded,
    osDisabled,
    toggleOS,
    setOSEnabledBatch,
    sdeLoaded,
    sdeDisabled,
    toggleSde,
    setSdeEnabledBatch,
  };
}
