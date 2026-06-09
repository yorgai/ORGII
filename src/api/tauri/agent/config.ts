/**
 * Agent Config API — unified legacy-blob compatibility adapter.
 *
 * Re-assembles the legacy UI-facing blob from the two canonical stores:
 *
 * - `AgentDefinition` (via `rpc.agentDef`) — per-agent fields like
 *   `compaction`, `reliability`, `policy`, `execTimeout`. The "restrict
 *   file/exec ops to the workspace" toggle is `policy.workspaceOnly` —
 *   there is no parallel `restrictToWorkspace` field.
 * - `IntegrationsConfig` (via `rpc.integrations`) — app-wide integration
 *   fields (`webSearch`, `embedding`, `mcp.smitheryApiKey`) are NOT carried
 *   through the agent blob; their UIs talk to `rpc.integrations` directly to
 *   avoid silent write-back of unedited fields when an unrelated agent
 *   setting is saved.
 *
 * The blob is always **flat**: per-agent knobs sit at the top level
 * (`compaction`, `reliability`, ...) regardless of which
 * built-in agent (OS / SDE) is being edited.
 *
 * Writes split the blob into:
 *  - `extractAgentDefPatch(blob)` — fields that map onto
 *    `AgentDefinition` and route through `rpc.agentDef.updatePatch`.
 *  - `extractIntegrationsPatch(blob)` — currently returns an empty patch;
 *    integration UIs update `rpc.integrations` directly.
 */
import type { AgentToolFilter } from "@src/api/tauri/agent/types";
import { rpc } from "@src/api/tauri/rpc";

const OS_AGENT_ID = "builtin:os";
const SDE_AGENT_ID = "builtin:sde";

type AgentKind = "os" | "sde";

export interface CommandRiskRules {
  medium: string[];
  high: string[];
}

let commandRiskRulesDefaultPromise: Promise<CommandRiskRules> | null = null;

export function cloneCommandRiskRules(
  rules: CommandRiskRules
): CommandRiskRules {
  return {
    medium: [...rules.medium],
    high: [...rules.high],
  };
}

export async function getDefaultCommandRiskRules(): Promise<CommandRiskRules> {
  commandRiskRulesDefaultPromise ??= rpc.agentDef.commandRiskRulesDefault();
  return cloneCommandRiskRules(await commandRiskRulesDefaultPromise);
}

function agentIdFor(agentType: AgentToolFilter): string {
  if (agentType === "os") return OS_AGENT_ID;
  if (agentType === "sde") return SDE_AGENT_ID;
  return agentType as string;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function stringArrayOrUndefined(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function riskRulesForBlob(
  value: unknown,
  defaultRiskRules: CommandRiskRules
): CommandRiskRules {
  const riskRules = toRecord(value);
  return {
    medium: stringArrayOrUndefined(riskRules.medium) ?? [
      ...defaultRiskRules.medium,
    ],
    high: stringArrayOrUndefined(riskRules.high) ?? [...defaultRiskRules.high],
  };
}

/**
 * Build the unified flat blob shared by OS and SDE settings UIs.
 *
 * Per-agent fields (contextWindow / maxTokens / temperature / model /
 * compaction / reliability / execTimeout / etc.) live at
 * the top level. Workspace restriction lives under `security.workspaceOnly`
 * (which maps to `agentPolicy.workspaceOnly`). App-wide integration fields
 * (`embedding`, `webSearch`, `mcp.smitheryApiKey`) are deliberately NOT
 * injected — their dedicated UIs hit `rpc.integrations` directly so saving
 * an unrelated OS Agent field cannot silently echo them back.
 */
export function assembleAgentConfigBlob(
  def: Record<string, unknown>,
  _integrations: Record<string, unknown>,
  kind: AgentKind,
  defaultRiskRules: CommandRiskRules
): Record<string, unknown> {
  const sessionModel = toRecord(def.sessionModel);
  const agentPolicy = toRecord(def.agentPolicy);
  const agentTools = toRecord(def.tools);

  const blob: Record<string, unknown> = {
    // Per-agent knobs (flat — both kinds use the same path).
    soulContent: typeof def.soulContent === "string" ? def.soulContent : "",
    contextWindow: def.contextWindow ?? null,
    maxTokens: def.maxTokens ?? (kind === "os" ? 8192 : 16384),
    temperature: def.temperature ?? (kind === "os" ? 0.7 : 0),
    model: def.selectedModelId ?? "",
    maxIterations: sessionModel.maxIterations ?? 500,
    compaction: toRecord(sessionModel.compaction),
    loadWorkspaceResources:
      def.loadWorkspaceResources ?? def.loadWorkspaceSettings ?? true,
    loadWorkspaceRules:
      def.loadWorkspaceRules ?? def.loadWorkspaceSettings ?? true,
    reliability: toRecord(def.reliability),
    learnings: toRecord(def.learnings),
    subAgents: def.subAgents ?? null,
    maxToolUseConcurrency: def.maxToolUseConcurrency ?? 10,

    // Per-agent exec controls (formerly app-wide on IntegrationsConfig.exec,
    // now stored on AgentDefinition so OS and SDE can have independent
    // values). `restrictToWorkspace` was retired; the single source of
    // truth is `security.workspaceOnly` below.
    execTimeout: (def.execTimeout as number) ?? (kind === "os" ? 60 : 120),

    security: {
      autonomy: agentPolicy.autonomy ?? "full",
      workspaceOnly: agentPolicy.workspaceOnly ?? false,
      blockedCommands: agentPolicy.blockedCommands ?? [],
      forbiddenPaths: agentPolicy.forbiddenPaths ?? [],
      riskRules: riskRulesForBlob(agentPolicy.riskRules, defaultRiskRules),
    },

    // Top-level mirrors of AgentToolSelection — read by useToolsSharedConfig
    // (excludedTools / userAllowedTools) and AgentMcpSection
    // (disabledMcpServers / disabledMcpTools). Echoed back on save.
    excludedTools: agentTools.excludedTools ?? [],
    userAllowedTools: agentTools.userAllowedTools ?? [],
    disabledMcpServers: agentTools.disabledMcpServers ?? [],
    disabledMcpTools: agentTools.disabledMcpTools ?? [],

    // Echo authoritative previous values so writers can do
    // read-modify-write without losing siblings (the backend replaces
    // these structs wholesale).
    _defaultRiskRules: cloneCommandRiskRules(defaultRiskRules),
    _agentPolicy: agentPolicy,
    _agentTools: agentTools,
    _sessionModel: sessionModel,
  };
  return blob;
}

export async function getAgentConfig(
  agentType: AgentToolFilter,
  _workspacePath?: string
): Promise<unknown> {
  const agentId = agentIdFor(agentType);
  const def = (await rpc.agentDef.get({ agentId })) as Record<string, unknown>;

  if (agentType === "os" || agentType === "sde") {
    const [integrations, defaultRiskRules] = await Promise.all([
      rpc.integrations.get() as Promise<Record<string, unknown>>,
      getDefaultCommandRiskRules(),
    ]);
    return assembleAgentConfigBlob(
      def,
      integrations,
      agentType,
      defaultRiskRules
    );
  }
  return def;
}

/**
 * Legacy blob-shaped update.
 *
 * Splits the incoming blob into two patches:
 * - `AgentDefinition` patch via `rpc.agentDef.updatePatch`
 * - `IntegrationsConfig` patch via `rpc.integrations.updatePatch`
 *
 * Only the top-level keys present on the incoming `update` object are
 * forwarded — this preserves partial-update semantics.
 */
export async function updateAgentConfig(
  agentType: AgentToolFilter,
  update: unknown,
  _workspacePath?: string
): Promise<void> {
  const agentId = agentIdFor(agentType);
  const blob = toRecord(update);

  if (agentType === "os" || agentType === "sde") {
    const agentPatch = extractAgentDefPatch(blob);
    const integrationsPatch =
      agentType === "os" ? extractIntegrationsPatch(blob) : {};

    const promises: Promise<unknown>[] = [];
    if (Object.keys(agentPatch).length > 0) {
      promises.push(rpc.agentDef.updatePatch({ agentId, patch: agentPatch }));
    }
    if (Object.keys(integrationsPatch).length > 0) {
      promises.push(rpc.integrations.updatePatch({ patch: integrationsPatch }));
    }
    await Promise.all(promises);
    return;
  }

  await rpc.agentDef.updatePatch({ agentId, patch: blob });
}

/**
 * Build the AgentDefinition-side patch from the unified flat blob.
 *
 * Reads top-level keys; emits only the fields the UI actually edited
 * (`if "X" in blob`) so partial updates don't accidentally clobber
 * untouched fields.
 */
export function extractAgentDefPatch(
  blob: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if ("soulContent" in blob) patch.soulContent = blob.soulContent;
  if ("contextWindow" in blob && blob.contextWindow !== null)
    patch.contextWindow = blob.contextWindow;
  if ("maxTokens" in blob) patch.maxTokens = blob.maxTokens;
  if ("temperature" in blob) patch.temperature = blob.temperature;
  if ("model" in blob) patch.selectedModelId = blob.model;
  if ("reliability" in blob) patch.reliability = blob.reliability;
  if ("learnings" in blob) patch.learnings = blob.learnings;
  if ("subAgents" in blob) patch.subAgents = blob.subAgents;
  if ("maxToolUseConcurrency" in blob)
    patch.maxToolUseConcurrency = blob.maxToolUseConcurrency;
  if ("execTimeout" in blob) patch.execTimeout = blob.execTimeout;
  if ("loadWorkspaceResources" in blob)
    patch.loadWorkspaceResources = blob.loadWorkspaceResources;
  if ("loadWorkspaceRules" in blob)
    patch.loadWorkspaceRules = blob.loadWorkspaceRules;
  // `restrictToWorkspace` no longer exists on AgentDefinition; the
  // unified field is `agentPolicy.workspaceOnly`, which is mapped from
  // the blob's `security.workspaceOnly` below.

  if ("compaction" in blob || "maxIterations" in blob) {
    patch.sessionModel = buildSessionModelPatch(blob, {
      compaction: "compaction" in blob ? blob.compaction : undefined,
      maxIterations: "maxIterations" in blob ? blob.maxIterations : undefined,
    });
  }

  if ("security" in blob) {
    patch.agentPolicy = buildAgentPolicyPatch(blob);
  }

  if (hasAgentToolsEdit(blob)) {
    patch.tools = buildAgentToolsPatch(blob);
  }

  return patch;
}

/**
 * Build the IntegrationsConfig-side patch from the unified flat blob.
 *
 * App-wide integrations fields (`webSearch`, `embedding`,
 * `mcp.smitheryApiKey`) are edited by their own UIs which hit
 * `rpc.integrations` directly, and are NOT echoed through this patch.
 *
 * Per-agent exec controls (`execTimeout`) live on `AgentDefinition` and
 * route via `extractAgentDefPatch`. Workspace restriction is part of
 * `agentPolicy` (`security.workspaceOnly` in the blob).
 */
export function extractIntegrationsPatch(
  _blob: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  return patch;
}

/**
 * Build a full `AgentPolicy` patch from the unified blob shape.
 *
 * `AgentDefinitionPatch` replaces `agentPolicy` wholesale, so we
 * echo the authoritative previous value (carried in `_agentPolicy`)
 * and overlay the UI-edited `security.*` fields. Tool allow/deny is
 * not represented on `AgentPolicy` anymore — it lives on
 * `AgentDefinition.tools.excludedTools` and the runtime access-mode policy.
 */
function buildAgentPolicyPatch(
  blob: Record<string, unknown>
): Record<string, unknown> {
  const previous = toRecord(blob._agentPolicy);
  const security = toRecord(blob.security);

  const merged: Record<string, unknown> = { ...previous };
  if ("autonomy" in security) merged.autonomy = security.autonomy;
  if ("workspaceOnly" in security)
    merged.workspaceOnly = security.workspaceOnly;
  if ("blockedCommands" in security)
    merged.blockedCommands = security.blockedCommands;
  if ("forbiddenPaths" in security)
    merged.forbiddenPaths = security.forbiddenPaths;
  if ("riskRules" in security) merged.riskRules = security.riskRules;

  return merged;
}

/**
 * Build a full `SessionModel` patch from the unified blob shape.
 *
 * `AgentDefinitionPatch.session_model: Option<SessionModel>` is applied
 * wholesale — `target.session_model = Some(v)` — so any field we omit
 * silently snaps back to the `Default` value. That means an OS Agent
 * (`mode: Singleton`) edit of just `compaction` would flip `mode` to
 * `PerSession`. We must echo the previous value (carried in
 * `_sessionModel`) and only overlay the explicitly-edited fields.
 */
function buildSessionModelPatch(
  blob: Record<string, unknown>,
  edits: { compaction?: unknown; maxIterations?: unknown }
): Record<string, unknown> {
  const previous = toRecord(blob._sessionModel);
  const merged: Record<string, unknown> = {
    // SessionMode is `serde(rename_all = "kebab-case")` on the wire —
    // `"singleton"` / `"per-session"`. Default matches Rust's
    // `SessionMode::default()` which is `PerSession`.
    mode: previous.mode ?? "per-session",
    processingLock: previous.processingLock ?? true,
    maxIterations: previous.maxIterations ?? 500,
  };
  if (previous.compaction !== undefined) {
    merged.compaction = previous.compaction;
  }
  if (edits.compaction !== undefined) merged.compaction = edits.compaction;
  if (edits.maxIterations !== undefined)
    merged.maxIterations = edits.maxIterations;
  return merged;
}

function hasAgentToolsEdit(blob: Record<string, unknown>): boolean {
  return (
    "excludedTools" in blob ||
    "userAllowedTools" in blob ||
    "disabledMcpServers" in blob ||
    "disabledMcpTools" in blob
  );
}

/**
 * Build a full `AgentToolSelection` patch from the unified blob shape.
 *
 * The backend replaces `tools` wholesale, so we merge the authoritative
 * previous value (echoed in `_agentTools`) with the UI's mutated fields.
 *
 * Fields that the user can edit through the new tools section:
 *   - `userAllowedTools` — user additions on top of the system set
 *   - `excludedTools` — user subtractions
 *   - `disabledMcpServers` / `disabledMcpTools` — MCP toggles
 *
 * `systemRestrictToTools` is preserved from the previous value — it is
 * authored by builtin definitions and is read-only in the UI. We must
 * not silently overwrite it.
 */
function buildAgentToolsPatch(
  blob: Record<string, unknown>
): Record<string, unknown> {
  const previous = toRecord(blob._agentTools);
  const merged: Record<string, unknown> = {
    userAllowedTools: previous.userAllowedTools ?? [],
    excludedTools: previous.excludedTools ?? [],
    disabledMcpServers: previous.disabledMcpServers ?? [],
    disabledMcpTools: previous.disabledMcpTools ?? [],
  };
  if (previous.systemRestrictToTools !== undefined) {
    merged.systemRestrictToTools = previous.systemRestrictToTools;
  }
  if ("userAllowedTools" in blob)
    merged.userAllowedTools = blob.userAllowedTools;
  if ("excludedTools" in blob) merged.excludedTools = blob.excludedTools;
  if ("disabledMcpServers" in blob)
    merged.disabledMcpServers = blob.disabledMcpServers;
  if ("disabledMcpTools" in blob)
    merged.disabledMcpTools = blob.disabledMcpTools;
  return merged;
}
