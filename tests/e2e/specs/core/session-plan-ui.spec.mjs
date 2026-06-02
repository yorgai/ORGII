import {
  CONTROL_LABEL_FILTER,
  assertKnownControlScenarios,
  listAccounts,
  runBuildThenNewPlanScenario,
  runFirstChatThenNewPlanScenario,
  runPendingPlanSideChatScenario,
  runPendingPlanSideChatThenUpdateScenario,
  runReloadFollowupBuildChatRewindScenario,
  runRustAgentSwitchModeToPlanScenario,
  runSkipPendingPlanThenChatScenario,
  scenarioConfigs,
  shouldRunScenario,
  waitForApp,
} from "../../support/core/session/agentPlanFollowupScenarios.mjs";
import {
  isClaudeCodeConfig,
  isClaudeCodeTransientAuthError,
  isGeminiConfig,
  isGeminiTransientCapacityError,
  isProviderAccountBlockedError,
  isProviderNondeterministicMarkerError,
} from "../../support/core/session/agentQueuedFollowupScenarios.mjs";

const PLAN_SCENARIO_NAMES = [
  "rust-agent-switch-mode-to-plan",
  "plan-pending-side-chat",
  "plan-skip-then-chat",
  "plan-first-chat-then-new-plan",
  "plan-side-chat-then-update",
  "plan-build-then-new-plan",
  "plan-reload-followup-build-chat-rewind",
];

async function runPlanScenarioWithProviderFallback(
  config,
  scenarioName,
  runner
) {
  const configsToTry = [config, ...(config.fallbackConfigs ?? [])];
  let lastError = null;

  for (const candidateConfig of configsToTry) {
    try {
      await runner(candidateConfig);
      if (candidateConfig !== config) {
        const chainLabel = isGeminiConfig(candidateConfig)
          ? "gemini"
          : isClaudeCodeConfig(candidateConfig)
            ? "claude-code"
            : "provider";
        console.log(
          `[plan-${chainLabel}-chain] scenario=${scenarioName} recovered with account=${candidateConfig.account.name ?? candidateConfig.account.id} model=${candidateConfig.model}`
        );
      }
      return "passed";
    } catch (error) {
      lastError = error;
      const canTryGeminiFallback =
        isGeminiConfig(candidateConfig) &&
        isGeminiTransientCapacityError(error);
      const canTryClaudeCodeFallback =
        isClaudeCodeConfig(candidateConfig) &&
        isClaudeCodeTransientAuthError(error);
      const canTryProviderAccountFallback =
        isProviderAccountBlockedError(error);
      const canTryProviderMarkerFallback =
        (isGeminiConfig(candidateConfig) ||
          isClaudeCodeConfig(candidateConfig)) &&
        isProviderNondeterministicMarkerError(error);

      if (
        !canTryGeminiFallback &&
        !canTryClaudeCodeFallback &&
        !canTryProviderAccountFallback &&
        !canTryProviderMarkerFallback
      ) {
        throw error;
      }

      const chainLabel = canTryGeminiFallback
        ? "gemini"
        : canTryClaudeCodeFallback
          ? "claude-code"
          : "provider";
      console.warn(
        `[plan-${chainLabel}-chain] scenario=${scenarioName} account=${candidateConfig.account.name ?? candidateConfig.account.id} model=${candidateConfig.model} hit retryable provider/account issue; trying next fallback. error=${String(error?.message ?? error).slice(0, 700)}`
      );
    }
  }

  console.warn(
    `[plan-provider-blocker] scenario=${scenarioName} label=${config.label} exhausted provider/account fallback chain; skipping this config. error=${String(lastError?.message ?? lastError).slice(0, 900)}`
  );
  return "provider-blocked";
}

describe("ORGII Plan follow-up lifecycle behavior", function () {
  this.timeout(1_200_000);

  let configs;

  async function runScenario(scenarioName, runner) {
    if (!shouldRunScenario(scenarioName)) {
      this.skip();
      return;
    }
    let passedCount = 0;
    const providerBlockedLabels = [];
    for (const config of configs) {
      const result = await runPlanScenarioWithProviderFallback(
        config,
        scenarioName,
        runner
      );
      if (result === "passed") passedCount += 1;
      if (result === "provider-blocked")
        providerBlockedLabels.push(config.label);
    }
    if (CONTROL_LABEL_FILTER.length > 0 && providerBlockedLabels.length > 0) {
      throw new Error(
        `Scenario ${scenarioName} had provider/account-blocked requested labels: ${providerBlockedLabels.join(", ")}; selected=${configs.length}`
      );
    }
    if (passedCount === 0 && configs.length > 0) {
      throw new Error(
        `Scenario ${scenarioName} had no successful platform coverage; providerBlocked=${providerBlockedLabels.length} selected=${configs.length}`
      );
    }
  }

  before(async () => {
    assertKnownControlScenarios(PLAN_SCENARIO_NAMES);
    await waitForApp();
    const allConfigs = scenarioConfigs(await listAccounts());
    configs = allConfigs.filter((config) => config.category === "rust_agent");
    if (configs.length === 0) {
      throw new Error(
        `No Rust Plan configs matched E2E_CONTROL_LABELS=${JSON.stringify(CONTROL_LABEL_FILTER)}; ORGII Plan card lifecycle scenarios only apply to Rust AgentExecMode sessions.`
      );
    }
  });

  it("routes Rust agent mode switching through ORGII suggest_mode_switch before showing a Plan card", async function () {
    if (!shouldRunScenario("rust-agent-switch-mode-to-plan")) {
      this.skip();
      return;
    }
    const rustConfigs = configs.filter(
      (candidate) => candidate.category === "rust_agent"
    );
    if (rustConfigs.length === 0) {
      throw new Error(
        "Scenario rust-agent-switch-mode-to-plan has no available Rust agent configs"
      );
    }

    let passedCount = 0;
    const providerBlockedLabels = [];
    for (const config of rustConfigs) {
      const result = await runPlanScenarioWithProviderFallback(
        config,
        "rust-agent-switch-mode-to-plan",
        runRustAgentSwitchModeToPlanScenario
      );
      if (result === "passed") {
        passedCount += 1;
        console.log(
          `[plan-rust-switch-mode-matrix] PASS label=${config.label}`
        );
      }
      if (result === "provider-blocked")
        providerBlockedLabels.push(config.label);
    }
    if (CONTROL_LABEL_FILTER.length > 0 && providerBlockedLabels.length > 0) {
      throw new Error(
        `Scenario rust-agent-switch-mode-to-plan had provider/account-blocked requested Rust labels: ${providerBlockedLabels.join(", ")}; selected=${rustConfigs.length}`
      );
    }
    if (passedCount === 0) {
      throw new Error(
        `Scenario rust-agent-switch-mode-to-plan had no successful Rust agent coverage; providerBlocked=${providerBlockedLabels.length} selected=${rustConfigs.length}`
      );
    }
  });

  it("keeps an unbuilt pending plan pinned and collapsed while chatting about other topics", async function () {
    await runScenario.call(
      this,
      "plan-pending-side-chat",
      runPendingPlanSideChatScenario
    );
  });

  it("skips a pending plan and continues chatting across the plan-capable matrix", async function () {
    await runScenario.call(
      this,
      "plan-skip-then-chat",
      runSkipPendingPlanThenChatScenario
    );
  });

  it("creates a new Plan after an ordinary first chat", async function () {
    await runScenario.call(
      this,
      "plan-first-chat-then-new-plan",
      runFirstChatThenNewPlanScenario
    );
  });

  it("updates a pending Plan after side chat without stale build actions", async function () {
    await runScenario.call(
      this,
      "plan-side-chat-then-update",
      runPendingPlanSideChatThenUpdateScenario
    );
  });

  it("creates a fresh Plan after a previous Plan was built", async function () {
    await runScenario.call(
      this,
      "plan-build-then-new-plan",
      runBuildThenNewPlanScenario
    );
  });

  it("restores a pending plan after reload, updates it, builds latest revision, chats normally, and rewinds", async function () {
    await runScenario.call(
      this,
      "plan-reload-followup-build-chat-rewind",
      runReloadFollowupBuildChatRewindScenario
    );
  });
});
