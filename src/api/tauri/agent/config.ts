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
    loadWorkspaceResources: def.loadWorkspaceResources ?? true,
    loadWorkspaceRules: def.loadWorkspaceRules ?? true,
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

    // Risk-rule defaults still ride along for UI rendering fallbacks.
    _defaultRiskRules: cloneCommandRiskRules(defaultRiskRules),
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
    patch.sessionModel = buildSessionModelPatch({
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
 * Build an `AgentPolicyPatch` from the unified blob shape.
 *
 * The backend now merges field-level (`AgentPolicyPatch`): absent keys
 * keep the stored value, so we forward ONLY the edited `security.*`
 * fields — no `_agentPolicy` echo, no read-modify-write.
 */
function buildAgentPolicyPatch(
  blob: Record<string, unknown>
): Record<string, unknown> {
  const security = toRecord(blob.security);

  const patch: Record<string, unknown> = {};
  if ("autonomy" in security) patch.autonomy = security.autonomy;
  if ("workspaceOnly" in security) patch.workspaceOnly = security.workspaceOnly;
  if ("blockedCommands" in security)
    patch.blockedCommands = security.blockedCommands;
  if ("forbiddenPaths" in security)
    patch.forbiddenPaths = security.forbiddenPaths;
  if ("riskRules" in security) patch.riskRules = security.riskRules;

  return patch;
}

/**
 * Build a `SessionModelPatch` from the unified blob shape.
 *
 * The backend merges field-level (`SessionModelPatch`): absent keys keep
 * the stored values, so editing just `compaction` can no longer snap
 * `mode` back to `per-session`. Forward ONLY the edited fields.
 */
function buildSessionModelPatch(edits: {
  compaction?: unknown;
  maxIterations?: unknown;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (edits.compaction !== undefined) patch.compaction = edits.compaction;
  if (edits.maxIterations !== undefined)
    patch.maxIterations = edits.maxIterations;
  return patch;
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
 * Build an `AgentToolSelectionPatch` from the unified blob shape.
 *
 * The backend merges field-level (`AgentToolSelectionPatch`): absent
 * keys keep the stored lists, and `systemRestrictToTools` is never sent
 * from this path (it is authored by builtin definitions and stripped by
 * `gate_for_builtin` anyway). No `_agentTools` echo needed.
 */
function buildAgentToolsPatch(
  blob: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if ("userAllowedTools" in blob)
    patch.userAllowedTools = blob.userAllowedTools;
  if ("excludedTools" in blob) patch.excludedTools = blob.excludedTools;
  if ("disabledMcpServers" in blob)
    patch.disabledMcpServers = blob.disabledMcpServers;
  if ("disabledMcpTools" in blob)
    patch.disabledMcpTools = blob.disabledMcpTools;
  return patch;
}
