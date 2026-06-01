/**
 * useCustomAgentConfig — `{ config, loaded, update }` adapter that
 * targets an arbitrary `AgentDefinition` on the custom-agent editor path.
 *
 * The reusable section components (`SecuritySection`, `AgentMcpSection`,
 * etc.) consume a flat config shape with paths like `security.autonomy`
 * and `disabledMcpServers`. This hook projects the typed `AgentDefinition`
 * schema onto that shape so those sections can be reused unchanged.
 * Writes are debounced and flushed through `agent_definitions_update`.
 *
 * Path mapping (frontend section path → AgentDefinition field):
 * - `security.autonomy`     → `agentPolicy.autonomy`
 * - `security.workspaceOnly`→ `agentPolicy.workspaceOnly`
 * - `security.blockedCommands` → `agentPolicy.blockedCommands`
 * - `security.riskRules`    → `agentPolicy.riskRules`
 * - `disabledMcpServers`    → `tools.disabledMcpServers`
 * - `disabledMcpTools`      → `tools.disabledMcpTools`
 * - `maxIterations`         → `sessionModel.maxIterations` (echoes the
 *                             previous `sessionModel` so other fields
 *                             like `mode`/`processingLock` survive a
 *                             partial edit)
 * - everything else         → identity (top-level field on AgentDefinition)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type CommandRiskRules,
  cloneCommandRiskRules,
  getDefaultCommandRiskRules,
} from "@src/api/tauri/agent/config";
import { createLogger } from "@src/hooks/logger";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";

import { setNested } from "../osAgent/utils";

const logger = createLogger("CustomAgentConfig");

export interface UseCustomAgentConfigReturn {
  config: Record<string, unknown>;
  loaded: boolean;
  update: (path: string, value: unknown) => void;
}

interface UseCustomAgentConfigArgs {
  agent: AgentDefinition | undefined;
  /** Caller-supplied patch save fn. Patches replace only the edited top-level field. */
  onPersist: (patch: Record<string, unknown>) => Promise<void>;
}

/**
 * Section-path → AgentDefinition-path translator. Keep section-side
 * identifiers (`policy`, `security`, `disabledMcpServers`) so the OS /
 * SDE-shaped UI components reuse without forking.
 */
function translatePath(path: string): string {
  if (path === "security") return "agentPolicy";
  if (path.startsWith("security.")) {
    return `agentPolicy.${path.slice("security.".length)}`;
  }
  if (path === "disabledMcpServers" || path === "disabledMcpTools") {
    return `tools.${path}`;
  }
  if (path === "maxIterations") return "sessionModel.maxIterations";
  if (path === "compaction") return "sessionModel.compaction";
  if (path.startsWith("compaction.")) {
    return `sessionModel.compaction.${path.slice("compaction.".length)}`;
  }
  return path;
}

function patchKeyForPath(realPath: string): string {
  return realPath.split(".")[0] ?? realPath;
}

function buildPatch(
  next: AgentDefinition,
  realPath: string
): Record<string, unknown> {
  const patchKey = patchKeyForPath(realPath);
  const nextRecord = next as unknown as Record<string, unknown>;
  return { [patchKey]: nextRecord[patchKey] };
}

function buildRiskRulesView(
  riskRules: unknown,
  defaultRiskRules: CommandRiskRules
): CommandRiskRules {
  const record =
    riskRules && typeof riskRules === "object"
      ? (riskRules as Record<string, unknown>)
      : {};
  const medium = Array.isArray(record.medium)
    ? record.medium.filter((item): item is string => typeof item === "string")
    : [...defaultRiskRules.medium];
  const high = Array.isArray(record.high)
    ? record.high.filter((item): item is string => typeof item === "string")
    : [...defaultRiskRules.high];

  return { medium, high };
}

/**
 * Build the flat `Record<string, unknown>` view consumed by the
 * reusable sections. We project the inverse of `translatePath` so the
 * sections can read back what they wrote.
 */
function projectConfig(
  agent: AgentDefinition,
  defaultRiskRules: CommandRiskRules
): Record<string, unknown> {
  const policy = agent.agentPolicy ?? {};
  const tools = agent.tools ?? {};
  const sessionModel = agent.sessionModel ?? null;
  const agentRecord = agent as unknown as Record<string, unknown>;
  const previousWorkspaceSetting =
    typeof agentRecord.loadWorkspaceSettings === "boolean"
      ? agentRecord.loadWorkspaceSettings
      : true;
  return {
    ...agentRecord,
    loadWorkspaceResources:
      agent.loadWorkspaceResources ?? previousWorkspaceSetting,
    loadWorkspaceRules: agent.loadWorkspaceRules ?? previousWorkspaceSetting,
    security: {
      autonomy: policy.autonomy,
      workspaceOnly: policy.workspaceOnly,
      blockedCommands: policy.blockedCommands ?? [],
      riskRules: buildRiskRulesView(policy.riskRules, defaultRiskRules),
    },
    disabledMcpServers: tools.disabledMcpServers ?? [],
    disabledMcpTools: tools.disabledMcpTools ?? [],
    compaction: sessionModel?.compaction ?? {},
    maxIterations: sessionModel?.maxIterations ?? 500,
    _defaultRiskRules: cloneCommandRiskRules(defaultRiskRules),
  };
}

export function useCustomAgentConfig(
  args: UseCustomAgentConfigArgs
): UseCustomAgentConfigReturn {
  const { agent, onPersist } = args;
  const [draft, setDraft] = useState<AgentDefinition | undefined>(agent);
  const [defaultRiskRules, setDefaultRiskRules] = useState<
    CommandRiskRules | undefined
  >(undefined);
  const draftAgentIdRef = useRef<string | undefined>(agent?.id);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{
    patch: Record<string, unknown>;
    persist: (patch: Record<string, unknown>) => Promise<void>;
  } | null>(null);

  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;
    void pending.persist(pending.patch).catch((err: unknown) => {
      logger.error("save failed:", err);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDefaultCommandRiskRules()
      .then((rules) => {
        if (!cancelled) setDefaultRiskRules(rules);
      })
      .catch((err: unknown) => {
        logger.error("load default command risk rules failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (agent?.id === draftAgentIdRef.current) return;
    flushPendingSave();
    draftAgentIdRef.current = agent?.id;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setDraft(agent);
    });
    return () => {
      cancelled = true;
    };
  }, [agent, flushPendingSave]);

  useEffect(() => {
    return () => {
      flushPendingSave();
    };
  }, [flushPendingSave]);

  const config = useMemo(() => {
    if (!draft || !defaultRiskRules) return {};
    return projectConfig(draft, defaultRiskRules);
  }, [defaultRiskRules, draft]);

  const update = useCallback(
    (path: string, value: unknown) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const realPath = translatePath(path);
        const nextRaw = setNested(
          prev as unknown as Record<string, unknown>,
          realPath,
          value
        );
        const next = nextRaw as unknown as AgentDefinition;
        const pendingPatch = pendingSaveRef.current?.patch ?? {};
        pendingSaveRef.current = {
          patch: {
            ...pendingPatch,
            ...buildPatch(next, realPath),
          },
          persist: onPersist,
        };
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(flushPendingSave, 500);
        return next;
      });
    },
    [flushPendingSave, onPersist]
  );

  return {
    config,
    loaded: draft !== undefined && defaultRiskRules !== undefined,
    update,
  };
}
