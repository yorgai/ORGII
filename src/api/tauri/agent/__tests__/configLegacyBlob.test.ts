/**
 * Regression tests for `agent/config.ts` — the unified-blob compatibility
 * adapter used by OS Agent / SDE Agent settings UIs.
 *
 * These tests pin the assemble↔extract round-trip behaviour for fields
 * that have been the subject of recent dead-write bugs:
 *
 * - P0-12: `tools.webSearch.apiKey` is NOT carried through the agent
 *   blob. The `web_search` tool and its Brave key configuration UI have
 *   been removed from the frontend; the agent config blob must not
 *   resurrect or echo the field even if Rust still ships the slice.
 * - P0-13: `excludedTools` (OS + SDE) round-trip
 * - P0-14: `disabledMcpServers` (SDE) round-trip
 * - P0-15: OS `subAgents` round-trip
 * - P0-16: `SessionModel` mode + processingLock preservation
 * - P0-17: `embedding` is NOT carried through the agent blob anymore.
 *   The embedding engine is app-wide and edited from the integrations
 *   page, never from an agent config blob.
 * - SDE `exec` partial patch — `execTimeout` preservation
 * - `restrictToWorkspace` is intentionally absent from the blob and
 *   patches: it was retired in favour of the unified
 *   `agentPolicy.workspaceOnly` field (mapped via `security.workspaceOnly`).
 *
 * Pure functions — no Tauri / RPC mocking needed.
 */
import { describe, expect, it } from "vitest";

import {
  type CommandRiskRules,
  assembleAgentConfigBlob,
  extractAgentDefPatch,
  extractIntegrationsPatch,
} from "../config";

function makeOsDef(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "builtin:os",
    name: "OS",
    builtIn: true,
    sessionModel: {
      mode: "singleton",
      maxIterations: 500,
      compaction: { enabled: true },
      processingLock: true,
    },
    learnings: { enabled: true, extractMemoriesEnabled: false },
    agentPolicy: {
      autonomy: "full",
      workspaceOnly: false,
      blockedCommands: ["rm -rf"],
      forbiddenPaths: ["~/.ssh"],
    },
    tools: {
      excludedTools: ["pre-existing"],
      userAllowedTools: [],
      disabledMcpServers: ["serverA"],
      disabledMcpTools: [],
      systemRestrictToTools: null,
    },
    subAgents: [{ id: "builtin:explore", role: "explorer" }],
    reliability: { maxRetries: 2, baseBackoffMs: 250, fallbackModels: ["m2"] },
    ...overrides,
  };
}

function makeIntegrations(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    embedding: {
      provider: "auto",
      model: "text-embed-3",
    },
    webSearch: { apiKey: "secret-brave-key" },
    mcp: { smitheryApiKey: "smithery-key" },
    ...overrides,
  };
}

const RUST_DEFAULT_COMMAND_RISK_RULES: CommandRiskRules = {
  medium: ["rust-medium-default"],
  high: ["rust-high-default"],
};

function assembleOs(
  def: Record<string, unknown> = makeOsDef(),
  integrations: Record<string, unknown> = makeIntegrations(),
  defaultRiskRules: CommandRiskRules = RUST_DEFAULT_COMMAND_RISK_RULES
): Record<string, unknown> {
  return assembleAgentConfigBlob(def, integrations, "os", defaultRiskRules);
}

describe("assembleAgentConfigBlob — OS kind", () => {
  it("does NOT carry webSearch.apiKey or other app-wide integrations into the blob (P0-12)", () => {
    const blob = assembleOs();
    expect(blob).not.toHaveProperty("tools");
    expect(blob).not.toHaveProperty("embedding");
  });

  it("echoes excludedTools / disabledMcpServers / disabledMcpTools at top level (P0-13)", () => {
    const blob = assembleOs();
    expect(blob.excludedTools).toEqual(["pre-existing"]);
    expect(blob.disabledMcpServers).toEqual(["serverA"]);
    expect(blob.disabledMcpTools).toEqual([]);
  });

  it("echoes the full AgentToolSelection in _agentTools for read-modify-write", () => {
    const blob = assembleOs();
    expect(blob._agentTools).toEqual({
      excludedTools: ["pre-existing"],
      userAllowedTools: [],
      disabledMcpServers: ["serverA"],
      disabledMcpTools: [],
      systemRestrictToTools: null,
    });
  });

  it("echoes subAgents at top level (P0-15)", () => {
    const blob = assembleOs();
    expect(blob.subAgents).toEqual([
      { id: "builtin:explore", role: "explorer" },
    ]);
  });

  it("defaults security to read + write access", () => {
    const blob = assembleOs(makeOsDef({ agentPolicy: {} }));
    expect(blob.security).toMatchObject({
      autonomy: "full",
      workspaceOnly: false,
    });
  });

  it("defaults command risk rules and forbidden paths into the security blob", () => {
    const blob = assembleOs(makeOsDef({ agentPolicy: {} }));
    expect(blob.security).toMatchObject({
      forbiddenPaths: [],
      riskRules: {
        medium: [...RUST_DEFAULT_COMMAND_RISK_RULES.medium],
        high: [...RUST_DEFAULT_COMMAND_RISK_RULES.high],
      },
    });
  });

  it("fills missing risk rule sides with defaults when hydrating security", () => {
    const blob = assembleOs(
      makeOsDef({
        agentPolicy: {
          riskRules: {
            medium: ["git status"],
          },
        },
      })
    );

    expect(blob.security).toMatchObject({
      riskRules: {
        medium: ["git status"],
        high: [...RUST_DEFAULT_COMMAND_RISK_RULES.high],
      },
    });
  });

  it("forwards security policy lists through extractAgentDefPatch", () => {
    const blob = assembleOs();
    const security = blob.security as Record<string, unknown>;
    security.forbiddenPaths = ["~/.ssh", "C:\\Users\\you\\.ssh"];
    security.riskRules = {
      medium: ["git status"],
      high: ["curl"],
    };
    const patch = extractAgentDefPatch(blob);
    expect(patch.agentPolicy).toMatchObject({
      forbiddenPaths: ["~/.ssh", "C:\\Users\\you\\.ssh"],
      riskRules: {
        medium: ["git status"],
        high: ["curl"],
      },
    });
  });
});

describe("extractAgentDefPatch — AgentToolSelection round-trip (P0-13)", () => {
  it("emits a wholesale tools patch on excludedTools edit, preserving siblings", () => {
    const blob = assembleOs();
    blob.excludedTools = ["pre-existing", "newly-disabled"];
    const patch = extractAgentDefPatch(blob);
    expect(patch.tools).toEqual({
      excludedTools: ["pre-existing", "newly-disabled"],
      userAllowedTools: [],
      disabledMcpServers: ["serverA"],
      disabledMcpTools: [],
      systemRestrictToTools: null,
    });
  });

  it("preserves systemRestrictToTools when previously set (specialist agents)", () => {
    const def = makeOsDef({
      tools: {
        excludedTools: [],
        userAllowedTools: [],
        disabledMcpServers: [],
        disabledMcpTools: [],
        systemRestrictToTools: ["explore", "ls"],
      },
    });
    const blob = assembleOs(def);
    blob.excludedTools = ["one-more"];
    const patch = extractAgentDefPatch(blob);
    const tools = patch.tools as Record<string, unknown>;
    expect(tools.systemRestrictToTools).toEqual(["explore", "ls"]);
  });

  it("emits tools patch echoing prior values when nothing was edited (idempotent)", () => {
    const blob = assembleOs();
    const patch = extractAgentDefPatch(blob);
    expect(patch.tools).toEqual({
      excludedTools: ["pre-existing"],
      userAllowedTools: [],
      disabledMcpServers: ["serverA"],
      disabledMcpTools: [],
      systemRestrictToTools: null,
    });
  });

  it("forwards userAllowedTools edits in the patch, preserving siblings", () => {
    const blob = assembleOs();
    blob.userAllowedTools = ["bash", "grep"];
    const patch = extractAgentDefPatch(blob);
    expect(patch.tools).toEqual({
      excludedTools: ["pre-existing"],
      userAllowedTools: ["bash", "grep"],
      disabledMcpServers: ["serverA"],
      disabledMcpTools: [],
      systemRestrictToTools: null,
    });
  });
});

describe("extractAgentDefPatch — subAgents round-trip (P0-15)", () => {
  it("forwards subAgents top-level edit into the patch", () => {
    const blob = assembleOs();
    blob.subAgents = [{ id: "builtin:plan", role: "planner" }];
    const patch = extractAgentDefPatch(blob);
    expect(patch.subAgents).toEqual([{ id: "builtin:plan", role: "planner" }]);
  });

  it("forwards subAgents = null to clear the list", () => {
    const blob = assembleOs();
    blob.subAgents = null;
    const patch = extractAgentDefPatch(blob);
    expect(patch.subAgents).toBeNull();
  });
});

describe("extractIntegrationsPatch — integration UIs own app-wide integration updates", () => {
  it("never emits `webSearch` even though IntegrationsConfig has a Brave key (P0-12)", () => {
    const blob = assembleOs();
    const patch = extractIntegrationsPatch(blob);
    expect(patch).not.toHaveProperty("webSearch");
  });

  it("never emits `embedding` from a regular OS Agent save (P0-17)", () => {
    const blob = assembleOs();
    const patch = extractIntegrationsPatch(blob);
    expect(patch).not.toHaveProperty("embedding");
  });

  it("never emits `mcp` (Smithery key is owned by its own integrations UI)", () => {
    const blob = assembleOs();
    const patch = extractIntegrationsPatch(blob);
    expect(patch).not.toHaveProperty("mcp");
  });
  it("emits an empty patch when only per-agent fields were edited", () => {
    const blob = assembleAgentConfigBlob(
      makeOsDef(),
      {},
      "os",
      RUST_DEFAULT_COMMAND_RISK_RULES
    );
    const patch = extractIntegrationsPatch(blob);
    expect(patch).toEqual({});
  });
});

describe("SessionModel preservation (P0-16) — mode + processingLock", () => {
  it("OS Singleton mode survives a compaction-only edit", () => {
    const def = makeOsDef({
      sessionModel: {
        mode: "singleton",
        compaction: { enabled: true, triggerRatio: 0.85 },
        processingLock: true,
        maxIterations: 500,
      },
    });
    const blob = assembleOs(def);
    blob.compaction = {
      enabled: false,
      triggerRatio: 0.85,
    };
    const patch = extractAgentDefPatch(blob);
    expect(patch.sessionModel).toEqual({
      mode: "singleton",
      processingLock: true,
      maxIterations: 500,
      compaction: { enabled: false, triggerRatio: 0.85 },
    });
  });

  it("OS maxIterations edit also preserves Singleton mode", () => {
    const def = makeOsDef({
      sessionModel: {
        mode: "singleton",
        compaction: null,
        processingLock: true,
        maxIterations: 500,
      },
    });
    const blob = assembleOs(def);
    blob.maxIterations = 1000;
    const patch = extractAgentDefPatch(blob);
    expect(patch.sessionModel).toEqual({
      mode: "singleton",
      processingLock: true,
      maxIterations: 1000,
      compaction: {},
    });
  });

  it("SDE per-session + processingLock survive a compaction-only edit", () => {
    const def: Record<string, unknown> = {
      id: "builtin:sde",
      sessionModel: {
        mode: "per-session",
        compaction: { enabled: true, triggerRatio: 0.9 },
        processingLock: true,
        maxIterations: 500,
      },
      learnings: { enabled: true },
      agentPolicy: { autonomy: "full" },
      tools: {
        excludedTools: [],
        disabledMcpServers: [],
        disabledMcpTools: [],
      },
    };
    const blob = assembleAgentConfigBlob(
      def,
      makeIntegrations(),
      "sde",
      RUST_DEFAULT_COMMAND_RISK_RULES
    );
    blob.compaction = { enabled: false };
    const patch = extractAgentDefPatch(blob);
    expect(patch.sessionModel).toEqual({
      mode: "per-session",
      processingLock: true,
      maxIterations: 500,
      compaction: { enabled: false },
    });
  });
});

describe("extractAgentDefPatch — SDE AgentToolSelection round-trip (P0-13/14)", () => {
  function makeSdeDef(): Record<string, unknown> {
    return {
      id: "builtin:sde",
      sessionModel: {
        mode: "per-session",
        maxIterations: 500,
        compaction: { enabled: true },
        processingLock: true,
      },
      learnings: { enabled: true },
      agentPolicy: {
        autonomy: "full",
      },
      tools: {
        excludedTools: [],
        disabledMcpServers: ["legacyServer"],
        disabledMcpTools: [],
      },
    };
  }

  function assembleSde(def: Record<string, unknown> = makeSdeDef()) {
    return assembleAgentConfigBlob(
      def,
      makeIntegrations(),
      "sde",
      RUST_DEFAULT_COMMAND_RISK_RULES
    );
  }

  it("emits wholesale tools patch on excludedTools edit", () => {
    const blob = assembleSde();
    blob.excludedTools = ["new-disabled-tool"];
    const patch = extractAgentDefPatch(blob);
    expect(patch.tools).toEqual({
      excludedTools: ["new-disabled-tool"],
      userAllowedTools: [],
      disabledMcpServers: ["legacyServer"],
      disabledMcpTools: [],
    });
  });

  it("emits wholesale tools patch on disabledMcpServers edit (P0-14)", () => {
    const blob = assembleSde();
    blob.disabledMcpServers = [];
    const patch = extractAgentDefPatch(blob);
    expect(patch.tools).toEqual({
      excludedTools: [],
      userAllowedTools: [],
      disabledMcpServers: [],
      disabledMcpTools: [],
    });
  });

  it("idempotently echoes tools patch even when only contextWindow changed", () => {
    const blob = assembleSde();
    blob.contextWindow = 64000;
    const patch = extractAgentDefPatch(blob);
    expect(patch.contextWindow).toBe(64000);
    expect(patch.tools).toEqual({
      excludedTools: [],
      userAllowedTools: [],
      disabledMcpServers: ["legacyServer"],
      disabledMcpTools: [],
    });
  });
});

describe("Compaction 8 knobs round-trip (top-level compaction key)", () => {
  // Backend source of truth: model_context::compaction::CompactionConfig
  // (`#[serde(rename_all = "camelCase")]`).
  function defWithFullCompaction(): Record<string, unknown> {
    return makeOsDef({
      sessionModel: {
        mode: "singleton",
        maxIterations: 500,
        processingLock: true,
        compaction: {
          enabled: true,
          triggerRatio: 0.8,
          keepRatio: 0.4,
          model: null,
          summaryMaxTokens: 4096,
          minMessages: 8,
          floorTokens: 16_000,
          reservedSummaryTokens: 20_000,
          bufferTokens: 13_000,
        },
      },
    });
  }

  it("assemble exposes all 8 compaction knobs verbatim under top-level compaction", () => {
    const blob = assembleOs(defWithFullCompaction());
    expect(blob.compaction).toEqual({
      enabled: true,
      triggerRatio: 0.8,
      keepRatio: 0.4,
      model: null,
      summaryMaxTokens: 4096,
      minMessages: 8,
      floorTokens: 16_000,
      reservedSummaryTokens: 20_000,
      bufferTokens: 13_000,
    });
  });

  it("editing reservedSummaryTokens preserves the other 7 siblings", () => {
    const blob = assembleOs(defWithFullCompaction());
    blob.compaction = {
      ...(blob.compaction as Record<string, unknown>),
      reservedSummaryTokens: 24_000,
    };
    const patch = extractAgentDefPatch(blob);
    const session = patch.sessionModel as Record<string, unknown>;
    expect(session.compaction).toEqual({
      enabled: true,
      triggerRatio: 0.8,
      keepRatio: 0.4,
      model: null,
      summaryMaxTokens: 4096,
      minMessages: 8,
      floorTokens: 16_000,
      reservedSummaryTokens: 24_000,
      bufferTokens: 13_000,
    });
    expect(session.mode).toBe("singleton");
    expect(session.processingLock).toBe(true);
  });

  it("editing bufferTokens preserves all other compaction siblings", () => {
    const blob = assembleOs(defWithFullCompaction());
    blob.compaction = {
      ...(blob.compaction as Record<string, unknown>),
      bufferTokens: 8_000,
    };
    const patch = extractAgentDefPatch(blob);
    const next = (patch.sessionModel as Record<string, unknown>)
      .compaction as Record<string, unknown>;
    expect(next.bufferTokens).toBe(8_000);
    expect(next.triggerRatio).toBe(0.8);
    expect(next.keepRatio).toBe(0.4);
    expect(next.summaryMaxTokens).toBe(4096);
    expect(next.minMessages).toBe(8);
    expect(next.floorTokens).toBe(16_000);
    expect(next.reservedSummaryTokens).toBe(20_000);
    expect(next.enabled).toBe(true);
  });

  it("setting enabled=false preserves all numeric siblings", () => {
    const blob = assembleOs(defWithFullCompaction());
    blob.compaction = {
      ...(blob.compaction as Record<string, unknown>),
      enabled: false,
    };
    const patch = extractAgentDefPatch(blob);
    const next = (patch.sessionModel as Record<string, unknown>)
      .compaction as Record<string, unknown>;
    expect(next.enabled).toBe(false);
    expect(next.triggerRatio).toBe(0.8);
    expect(next.keepRatio).toBe(0.4);
    expect(next.bufferTokens).toBe(13_000);
  });
});

describe("Sub-Agents allowlist round-trip (P0-15)", () => {
  function defWithSubAgents(): Record<string, unknown> {
    return makeOsDef({
      subAgents: [
        { agentId: "builtin:explore" },
        { agentId: "builtin:general" },
        { agentId: "builtin:sde" },
      ],
    });
  }

  it("assemble preserves the subAgents allowlist verbatim", () => {
    const blob = assembleOs(defWithSubAgents());
    expect(blob.subAgents).toEqual([
      { agentId: "builtin:explore" },
      { agentId: "builtin:general" },
      { agentId: "builtin:sde" },
    ]);
  });

  it("removing a row forwards the shorter list", () => {
    const blob = assembleOs(defWithSubAgents());
    blob.subAgents = (blob.subAgents as Array<Record<string, unknown>>).filter(
      (entry) => entry.agentId !== "builtin:sde"
    );
    const patch = extractAgentDefPatch(blob);
    expect(patch.subAgents).toHaveLength(2);
    expect(
      (patch.subAgents as Array<Record<string, unknown>>).map(
        (entry) => entry.agentId
      )
    ).not.toContain("builtin:sde");
  });

  it("adding a row forwards the longer allowlist", () => {
    const blob = assembleOs(defWithSubAgents());
    blob.subAgents = [
      ...(blob.subAgents as Array<Record<string, unknown>>),
      { agentId: "builtin:custom" },
    ];
    const patch = extractAgentDefPatch(blob);
    expect(patch.subAgents).toHaveLength(4);
    const last = (patch.subAgents as Array<Record<string, unknown>>)[3];
    expect(last).toEqual({ agentId: "builtin:custom" });
  });
});

describe("Sub-Agents max tool-use concurrency round-trip", () => {
  it("assemble exposes the per-agent runtime concurrency cap", () => {
    const blob = assembleOs(makeOsDef({ maxToolUseConcurrency: 7 }));
    expect(blob.maxToolUseConcurrency).toBe(7);
  });

  it("assemble defaults the cap to 10 when the definition has no override", () => {
    const blob = assembleOs(makeOsDef());
    expect(blob.maxToolUseConcurrency).toBe(10);
  });

  it("forwards edited maxToolUseConcurrency into the agent-def patch", () => {
    const blob = assembleOs(makeOsDef({ maxToolUseConcurrency: 7 }));
    blob.maxToolUseConcurrency = 3;
    const patch = extractAgentDefPatch(blob);
    expect(patch.maxToolUseConcurrency).toBe(3);
  });
});

describe("extractAgentDefPatch — execTimeout is per-agent (and restrictToWorkspace is retired)", () => {
  function makeSdeDef(
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      id: "builtin:sde",
      sessionModel: {
        mode: "per-session",
        compaction: null,
        processingLock: true,
        maxIterations: 500,
      },
      learnings: { enabled: true },
      agentPolicy: { autonomy: "full", workspaceOnly: false },
      tools: {
        excludedTools: [],
        disabledMcpServers: [],
        disabledMcpTools: [],
      },
      ...overrides,
    };
  }

  it("forwards an edited execTimeout into the agent-def patch", () => {
    const blob = assembleAgentConfigBlob(
      makeSdeDef({ execTimeout: 90 }),
      makeIntegrations(),
      "sde",
      RUST_DEFAULT_COMMAND_RISK_RULES
    );
    blob.execTimeout = 180;
    const patch = extractAgentDefPatch(blob);
    expect(patch.execTimeout).toBe(180);
    // Integrations patch should NEVER contain exec/timeout fields anymore.
    expect(extractIntegrationsPatch(blob)).not.toHaveProperty("exec");
  });

  it("does not surface or forward a `restrictToWorkspace` field — it was retired", () => {
    const blob = assembleAgentConfigBlob(
      makeSdeDef({ execTimeout: 90 }),
      makeIntegrations(),
      "sde",
      RUST_DEFAULT_COMMAND_RISK_RULES
    );
    expect(blob).not.toHaveProperty("restrictToWorkspace");

    // Even if a stale UI tried to set it, extractAgentDefPatch must not
    // forward it onto AgentDefinition (the field no longer exists).
    blob.restrictToWorkspace = true;
    const patch = extractAgentDefPatch(blob);
    expect(patch).not.toHaveProperty("restrictToWorkspace");
  });

  it("routes workspace-only edits through security.workspaceOnly → agentPolicy.workspaceOnly", () => {
    const blob = assembleAgentConfigBlob(
      makeSdeDef({ execTimeout: 90 }),
      makeIntegrations(),
      "sde",
      RUST_DEFAULT_COMMAND_RISK_RULES
    );
    const security = blob.security as Record<string, unknown>;
    security.workspaceOnly = true;
    blob.security = security;
    const patch = extractAgentDefPatch(blob);
    const policy = patch.agentPolicy as Record<string, unknown>;
    expect(policy.workspaceOnly).toBe(true);
  });

  it("seeds defaults when the agent definition has no prior exec values", () => {
    const blob = assembleAgentConfigBlob(
      makeSdeDef(),
      {},
      "sde",
      RUST_DEFAULT_COMMAND_RISK_RULES
    );
    expect(blob.execTimeout).toBe(120);
    expect(blob).not.toHaveProperty("restrictToWorkspace");
  });

  it("emits execTimeout in the agent-def patch when forwarded", () => {
    const blob = assembleAgentConfigBlob(
      makeSdeDef({ execTimeout: 60 }),
      makeIntegrations(),
      "sde",
      RUST_DEFAULT_COMMAND_RISK_RULES
    );
    blob.execTimeout = 240;
    const patch = extractAgentDefPatch(blob);
    expect(patch.execTimeout).toBe(240);
  });
});
