/* global browser, describe, before, it */
import {
  BUILTIN_SDE_AGENT_ID,
  DEFAULT_AGENT_ORG_ID,
  E2E_REPO_PATH,
  assertE2ERepoFixture,
  getApiAccount,
  invokeE2E,
  selectPreferredModel,
  unwrap,
  waitForAgentOrgRunViewByOrg,
  waitForApp,
  waitForSessionAggregateRow,
} from "../../support/core/agentOrgUiDriver.mjs";

const RUN_ID = Date.now();
const RENDER_TIMEOUT_MS = 30_000;
const SCENARIO_FILTER = (process.env.E2E_LAUNCH_WIRING_SCENARIOS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function shouldRunScenario(name) {
  return SCENARIO_FILTER.length === 0 || SCENARIO_FILTER.includes(name);
}

async function execJS(script) {
  return browser.executeScript(script, []);
}

async function waitForRenderedSession(sessionId, label) {
  let state = null;
  try {
    await browser.waitUntil(
      async () => {
        state = await execJS(`
          const chatPanel = document.querySelector('[data-testid="chat-panel"]');
          const history = document.querySelector('[data-testid="chat-message-list"]');
          const activeTab = document.querySelector('[data-session-tab="${sessionId}"]');
          const bodyText = document.body.innerText || '';
          return {
            hasChatPanel: Boolean(chatPanel),
            hasHistory: Boolean(history),
            hasActiveTab: Boolean(activeTab),
            bodyHasSession: bodyText.includes(${JSON.stringify(sessionId)}),
            bodyText: bodyText.slice(0, 1800),
          };
        `);
        const chatState = unwrap(
          await invokeE2E("inspectChatState"),
          `inspectChatState(${label})`
        );
        state.chatState = {
          activeSessionId: chatState.activeSessionId,
          activeSession: chatState.activeSession,
          coreSessionId: chatState.coreSessionId,
          sessionView: chatState.sessionView,
        };
        return (
          state.hasChatPanel && state.chatState.activeSessionId === sessionId
        );
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 500,
        timeoutMsg: `${label} did not render as active chat session`,
      }
    );
  } catch (error) {
    throw new Error(
      `${label} did not render as active chat session: latest=${JSON.stringify(state)} original=${String(error?.message ?? error)}`
    );
  }
  return state;
}

async function launchAndAssert({
  label,
  account,
  model,
  mode,
  agentDefinitionId,
  agentOrgId,
  expectedAgentDefinitionId,
  expectedAgentOrgId,
}) {
  const prompt = `E2E launch wiring ${label} ${RUN_ID}. Reply briefly.`;
  const result = unwrap(
    await invokeE2E("launchSession", {
      category: "rust_agent",
      content: prompt,
      workspacePath: E2E_REPO_PATH,
      keySource: "own_key",
      accountId: account.id,
      model,
      agentDefinitionId,
      agentOrgId,
      mode,
      background: false,
    }),
    `launchSession(${label})`
  ).result;
  const sessionId = result?.sessionId ?? result?.session_id;
  if (!sessionId) {
    throw new Error(
      `${label} launch did not create a session: ${JSON.stringify(result)}`
    );
  }

  await waitForSessionAggregateRow(
    sessionId,
    (session) =>
      session.model === model &&
      session.accountId === account.id &&
      session.agentExecMode === mode &&
      (expectedAgentDefinitionId === undefined ||
        session.agentDefinitionId === expectedAgentDefinitionId) &&
      (expectedAgentOrgId === undefined ||
        session.agentOrgId === expectedAgentOrgId),
    `${label} persisted session metadata`
  );

  unwrap(await invokeE2E("openSession", sessionId), `openSession(${label})`);
  const renderedState = await waitForRenderedSession(sessionId, label);
  if (renderedState.chatState.activeSession?.agentExecMode !== mode) {
    throw new Error(
      `${label} rendered active session mode mismatch: ${JSON.stringify(renderedState)}`
    );
  }
  return { sessionId, result };
}

async function removeAgentDefIfExists(agentId) {
  const defs = unwrap(
    await invokeE2E("listAgentDefs"),
    "listAgentDefs cleanup"
  ).defs;
  if (defs.some((definition) => definition?.id === agentId)) {
    await invokeE2E("removeAgentDef", agentId);
  }
}

describe("Session launch wiring rendered UI invariants", function () {
  this.timeout(180_000);

  let account;
  let model;

  before(async () => {
    assertE2ERepoFixture();
    await waitForApp();
    account = await getApiAccount();
    model = selectPreferredModel(account);
  });

  it("persists and renders builtin SDE launch modes", async function () {
    if (!shouldRunScenario("builtin-modes")) {
      this.skip();
      return;
    }

    for (const mode of ["build", "plan", "investigate"]) {
      await launchAndAssert({
        label: `builtin-sde-${mode}`,
        account,
        model,
        mode,
        agentDefinitionId: BUILTIN_SDE_AGENT_ID,
        expectedAgentDefinitionId: BUILTIN_SDE_AGENT_ID,
      });
    }
  });

  it("persists and renders custom AgentDefinition target metadata", async function () {
    if (!shouldRunScenario("custom-agent")) {
      this.skip();
      return;
    }

    const agentId = `e2e-launch-wiring-custom-${RUN_ID}`;
    const definition = {
      id: agentId,
      name: `E2E Launch Wiring Agent ${RUN_ID}`,
      description: "Temporary custom Agent for launch wiring E2E coverage.",
      builtIn: false,
      tier: "primary",
      inheritsFrom: BUILTIN_SDE_AGENT_ID,
      capabilities: { coding: { modeSwitch: true } },
      delegationConfig: { delegatable: true, contextBuilders: [] },
      sessionModel: {
        mode: "singleton",
        processingLock: true,
        maxIterations: 3,
      },
      agentPolicy: {
        autonomy: "full",
        workspaceOnly: true,
        blockedCommands: [],
        riskRules: { medium: [], high: [] },
      },
      tools: { userAllowedTools: [], excludedTools: [] },
      skillsConfig: { enabled: true, include: [], exclude: [], sourceDirs: [] },
    };

    try {
      await removeAgentDefIfExists(agentId);
      unwrap(
        await invokeE2E("addAgentDef", definition),
        "add custom launch wiring AgentDefinition"
      );
      unwrap(
        await invokeE2E("refreshAgentDefs"),
        "refresh custom launch wiring AgentDefinition"
      );
      await launchAndAssert({
        label: "custom-agent-debug",
        account,
        model,
        mode: "debug",
        agentDefinitionId: agentId,
        expectedAgentDefinitionId: agentId,
      });
    } finally {
      await invokeE2E("removeAgentDef", agentId);
    }
  });

  it("persists and renders Agent Org target metadata", async function () {
    if (!shouldRunScenario("agent-org")) {
      this.skip();
      return;
    }

    const result = unwrap(
      await invokeE2E("launchSession", {
        category: "rust_agent",
        content: `E2E launch wiring default Agent Org ${RUN_ID}. Reply briefly.`,
        workspacePath: E2E_REPO_PATH,
        keySource: "own_key",
        accountId: account.id,
        model,
        agentDefinitionId: BUILTIN_SDE_AGENT_ID,
        agentOrgId: DEFAULT_AGENT_ORG_ID,
        mode: "plan",
        background: false,
      }),
      "launchSession(default-agent-org-plan)"
    ).result;
    const rootSessionId = result?.sessionId ?? result?.session_id;
    const runId = result?.agentOrgRunId ?? result?.agent_org_run_id;
    if (!rootSessionId || !runId) {
      throw new Error(
        `Agent Org launch did not return root session/run ids: ${JSON.stringify(result)}`
      );
    }

    const runState = await waitForAgentOrgRunViewByOrg(
      DEFAULT_AGENT_ORG_ID,
      (view, run) =>
        run?.runId === runId &&
        run?.orgId === DEFAULT_AGENT_ORG_ID &&
        view?.context?.runId === runId &&
        (view?.members ?? []).length > 0,
      "default Agent Org launch wiring runtime view"
    );
    unwrap(
      await invokeE2E("openSession", rootSessionId),
      "openSession(default Agent Org root)"
    );
    await waitForRenderedSession(rootSessionId, "default-agent-org-plan");
    if (runState.run?.rootSessionId !== rootSessionId) {
      throw new Error(
        `Agent Org run root session mismatch: ${JSON.stringify({ result, runState })}`
      );
    }
  });
});
