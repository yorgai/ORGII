/* global browser, describe, before, it, process */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BUILTIN_SDE_AGENT_ID,
  DEFAULT_AGENT_ORG_ID,
  E2E_REPO_PATH,
  assertE2ERepoFixture,
  getApiAccount,
  invokeE2E,
  selectPreferredModel,
  selectRenderedDefaultAgentOrg,
  selectRenderedExecMode,
  sendFromRenderedCreator,
  unwrap,
  waitForAgentOrgRunViewByOrg,
  waitForApp,
  waitForSessionAggregateRow,
} from "../../support/core/agentOrgUiDriver.mjs";
import {
  ASK_FORBIDDEN_PROMPT_TOOL_NAMES,
  PLAN_FORBIDDEN_PROMPT_TOOL_NAMES,
  fetchToolInventory,
} from "../../support/core/session/toolCoverage.mjs";

const RUN_ID = Date.now();
const BUILTIN_OS_AGENT_ID = "builtin:os";
const RENDER_TIMEOUT_MS = 30_000;
const SCENARIO_FILTER = (process.env.E2E_LAUNCH_WIRING_SCENARIOS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function shouldRunScenario(name) {
  return SCENARIO_FILTER.length === 0 || SCENARIO_FILTER.includes(name);
}

function createTempWorkspaceDir(label) {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), `orgii-e2e-${label}-${RUN_ID}-`)
  );
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

async function assertModeToolInventory(mode, sessionId) {
  const inventory = await fetchToolInventory(sessionId);
  const promptTools = new Set(inventory.promptVisibleNames);
  const missing = [];
  const unexpected = [];

  const expectPresent = (name) => {
    if (!promptTools.has(name)) missing.push(name);
  };
  const expectAbsent = (name) => {
    if (promptTools.has(name)) unexpected.push(name);
  };

  if (mode === "build") {
    for (const name of ["read_file", "run_shell", "edit_file", "manage_todo"]) {
      expectPresent(name);
    }
    expectAbsent("create_plan");
  } else if (mode === "plan") {
    expectPresent("read_file");
    expectPresent("create_plan");
    expectAbsent("manage_todo");
    for (const name of PLAN_FORBIDDEN_PROMPT_TOOL_NAMES) expectAbsent(name);
  } else if (mode === "ask") {
    expectPresent("read_file");
    for (const name of ASK_FORBIDDEN_PROMPT_TOOL_NAMES) expectAbsent(name);
  }

  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Mode ${mode} tool inventory mismatch for ${sessionId}: missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)} inventory=${JSON.stringify(inventory)}`
    );
  }
}

async function assertPersistedSessionWorkspace(sessionId, expected) {
  const workspaceResult = unwrap(
    await invokeE2E("readSessionWorkspaceFromDb", sessionId),
    `readSessionWorkspaceFromDb(${sessionId})`
  ).result;
  const workspace = workspaceResult?.workspace ?? null;
  if (expected.workspaceRoot == null) {
    const hasPersistedRoot = Boolean(workspace?.workspaceRoot);
    const hasPersistedWorkingDir = Boolean(workspace?.workingDir);
    const hasAdditionalDirectories =
      (workspace?.additionalDirectories ?? []).length > 0;
    if (hasPersistedRoot || hasPersistedWorkingDir || hasAdditionalDirectories) {
      throw new Error(
        `Expected no persisted workspace for ${sessionId}, got ${JSON.stringify(workspaceResult)}`
      );
    }
    return;
  }

  const additional = (workspace?.additionalDirectories ?? [])
    .map((entry) => entry.path)
    .sort();
  const expectedAdditional = [...(expected.additionalDirectories ?? [])].sort();
  if (
    workspace?.workspaceRoot !== expected.workspaceRoot ||
    JSON.stringify(additional) !== JSON.stringify(expectedAdditional)
  ) {
    throw new Error(
      `Persisted workspace mismatch for ${sessionId}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(workspaceResult)}`
    );
  }
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

async function prepareRenderedCreator({
  account,
  model,
  agentDefinitionId,
  agentOrgId,
}) {
  unwrap(
    await invokeE2E("configureWithExistingKey", {
      accountName: account.name ?? account.id,
      model,
      agentType: account.agent_type,
      category: "rust_agent",
      agentDefinitionId,
      agentOrgId,
      repoPath: E2E_REPO_PATH,
    }),
    "configure rendered Session Creator account"
  );
  unwrap(
    await invokeE2E("navigateTo", "/orgii/workstation/code"),
    "navigate to workstation before rendered Session Creator reset"
  );
  unwrap(
    await invokeE2E("resetToNewSession"),
    "resetToNewSession before rendered Session Creator action"
  );
}

async function typeRenderedCreatorPrompt(prompt, label) {
  const state = await execJS(`
    const shell = document.querySelector('[data-testid="session-creator-chat-panel"]') ?? document;
    const editor = shell.querySelector('[contenteditable="true"]');
    if (!editor) return { ok: false, reason: "missing-editor" };
    editor.focus();
    editor.textContent = ${JSON.stringify(prompt)};
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(prompt)} }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    const button = shell.querySelector('[data-testid="chat-send-button"]');
    return {
      ok: true,
      editorText: editor.textContent || '',
      buttonState: button?.getAttribute('data-state') ?? null,
      buttonDisabled: button ? Boolean(button.disabled) : null,
    };
  `);
  if (state?.ok !== true || !String(state.editorText ?? "").includes(prompt)) {
    throw new Error(
      `${label} prompt was not typed into rendered creator: ${JSON.stringify(state)}`
    );
  }
  return state;
}

async function assertRenderedCreatorSendDisabled(label) {
  let state = null;
  await browser.waitUntil(
    async () => {
      state = await execJS(`
        const shell = document.querySelector('[data-testid="session-creator-chat-panel"]') ?? document;
        const button = shell.querySelector('[data-testid="chat-send-button"]');
        return {
          buttonPresent: Boolean(button),
          state: button?.getAttribute('data-state') ?? null,
          disabled: button ? Boolean(button.disabled) : null,
          bodyText: (document.body.innerText || '').slice(0, 1200),
        };
      `);
      return state?.buttonPresent === true && state?.disabled === true;
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      interval: 250,
      timeoutMsg: `${label} send button was not disabled: ${JSON.stringify(state)}`,
    }
  );
  return state;
}

async function selectRenderedAgentDefinition(agentId) {
  unwrap(
    await invokeE2E("navigateTo", "/orgii/workstation/code"),
    "navigate to workstation code"
  );
  await browser.waitUntil(
    async () =>
      execJS(
        `return !!document.querySelector('[data-testid="session-creator-agent-selector"]');`
      ),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg:
        "SessionCreator agent selector never rendered for AgentDefinition selection",
    }
  );
  const openResult = await execJS(`
    const selector = document.querySelector('[data-testid="session-creator-agent-selector"]');
    if (!selector) return "missing";
    selector.click();
    return "clicked";
  `);
  if (openResult !== "clicked") {
    throw new Error(
      `Agent selector did not open for ${agentId}: ${openResult}`
    );
  }
  const optionSelector = `[data-testid="session-creator-agent-option-def-${agentId}"]`;
  await browser.waitUntil(
    async () =>
      execJS(
        `return !!document.querySelector(${JSON.stringify(optionSelector)});`
      ),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `AgentDefinition option ${agentId} never rendered`,
    }
  );
  const clickResult = await execJS(`
    const option = document.querySelector(${JSON.stringify(optionSelector)});
    if (!option) return "missing";
    option.click();
    return "clicked";
  `);
  if (clickResult !== "clicked") {
    throw new Error(
      `AgentDefinition option ${agentId} did not click: ${clickResult}`
    );
  }
  const selection = unwrap(
    await invokeE2E("inspectCreatorSelection"),
    `inspectCreatorSelection(${agentId})`
  ).creator;
  if (selection.selectedAgentDefinitionId !== agentId) {
    throw new Error(
      `AgentDefinition selector mismatch for ${agentId}: ${JSON.stringify(selection)}`
    );
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

    for (const mode of ["build", "plan", "ask"]) {
      const { sessionId } = await launchAndAssert({
        label: `builtin-sde-${mode}`,
        account,
        model,
        mode,
        agentDefinitionId: BUILTIN_SDE_AGENT_ID,
        expectedAgentDefinitionId: BUILTIN_SDE_AGENT_ID,
      });
      await assertModeToolInventory(mode, sessionId);
    }
  });

  it("launches OS Agent Ask mode safely with zero repos selected", async function () {
    if (!shouldRunScenario("zero-repo-os-ask")) {
      this.skip();
      return;
    }

    try {
      unwrap(await invokeE2E("clearWorkspaceRepos"), "clear workspace repos");
      const result = unwrap(
        await invokeE2E("launchSession", {
          category: "rust_agent",
          content: `E2E zero repo OS Ask launch ${RUN_ID}. Reply briefly.`,
          keySource: "own_key",
          accountId: account.id,
          model,
          agentDefinitionId: BUILTIN_OS_AGENT_ID,
          mode: "ask",
          background: false,
        }),
        "launchSession(zero-repo-os-ask)"
      ).result;
      const sessionId = result?.sessionId ?? result?.session_id;
      if (!sessionId) {
        throw new Error(
          `Zero repo OS Ask launch did not create a session: ${JSON.stringify(result)}`
        );
      }

      await waitForSessionAggregateRow(
        sessionId,
        (session) =>
          session.model === model &&
          session.accountId === account.id &&
          session.agentDefinitionId === BUILTIN_OS_AGENT_ID &&
          session.agentExecMode === "ask" &&
          (session.workspacePath == null || session.workspacePath === ""),
        "zero repo OS Ask launch metadata"
      );
      await assertModeToolInventory("ask", sessionId);
      await assertPersistedSessionWorkspace(sessionId, { workspaceRoot: null });
    } finally {
      await invokeE2E("ensureRepoSelected", { repoPath: E2E_REPO_PATH });
    }
  });

  it("blocks SDE Agent launch from rendered creator when zero repos are selected", async function () {
    if (!shouldRunScenario("zero-repo-sde-guard")) {
      this.skip();
      return;
    }

    try {
      await prepareRenderedCreator({
        account,
        model,
        agentDefinitionId: BUILTIN_SDE_AGENT_ID,
      });
      unwrap(await invokeE2E("clearWorkspaceRepos"), "clear workspace repos");
      await selectRenderedAgentDefinition(BUILTIN_SDE_AGENT_ID);
      await selectRenderedExecMode("ask");

      const selection = unwrap(
        await invokeE2E("inspectCreatorSelection"),
        "inspectCreatorSelection(zero-repo-sde-guard)"
      ).creator;
      if (selection.source != null) {
        throw new Error(
          `SDE zero-repo guard expected no creator source, got ${JSON.stringify(selection)}`
        );
      }

      await typeRenderedCreatorPrompt(
        `E2E SDE zero repo guard ${RUN_ID}. This should not launch.`,
        "zero repo SDE guard"
      );
      await assertRenderedCreatorSendDisabled("zero repo SDE guard");
    } finally {
      await invokeE2E("ensureRepoSelected", { repoPath: E2E_REPO_PATH });
    }
  });

  it("passes multi-root workspace folders as additional session directories", async function () {
    if (!shouldRunScenario("multi-root-workspace")) {
      this.skip();
      return;
    }

    const primaryPath = createTempWorkspaceDir("multi-primary");
    const secondaryPath = createTempWorkspaceDir("multi-secondary");
    const tertiaryPath = createTempWorkspaceDir("multi-tertiary");
    try {
      const seeded = unwrap(
        await invokeE2E("seedMultiRootWorkspace", {
          workspaceId: `e2e-multi-root-${RUN_ID}`,
          workspaceName: `E2E Multi Root ${RUN_ID}`,
          folders: [
            {
              id: "primary",
              name: "primary",
              path: primaryPath,
              isPrimary: true,
            },
            { id: "secondary", name: "secondary", path: secondaryPath },
            { id: "tertiary", name: "tertiary", path: tertiaryPath },
          ],
        }),
        "seed multi-root workspace"
      );

      const result = unwrap(
        await invokeE2E("launchSession", {
          category: "rust_agent",
          content: `E2E multi-root launch ${RUN_ID}. Reply briefly.`,
          keySource: "own_key",
          accountId: account.id,
          model,
          agentDefinitionId: BUILTIN_SDE_AGENT_ID,
          mode: "ask",
          background: false,
        }),
        "launchSession(multi-root-workspace)"
      ).result;
      const sessionId = result?.sessionId ?? result?.session_id;
      if (!sessionId) {
        throw new Error(
          `Multi-root launch did not create a session: ${JSON.stringify(result)}`
        );
      }

      await waitForSessionAggregateRow(
        sessionId,
        (session) =>
          session.model === model &&
          session.accountId === account.id &&
          session.agentDefinitionId === BUILTIN_SDE_AGENT_ID &&
          session.agentExecMode === "ask" &&
          session.workspacePath === seeded.primaryPath,
        "multi-root launch metadata"
      );
      await assertPersistedSessionWorkspace(sessionId, {
        workspaceRoot: seeded.primaryPath,
        additionalDirectories: seeded.additionalDirectories,
      });
    } finally {
      await invokeE2E("ensureRepoSelected", { repoPath: E2E_REPO_PATH });
      fs.rmSync(primaryPath, { recursive: true, force: true });
      fs.rmSync(secondaryPath, { recursive: true, force: true });
      fs.rmSync(tertiaryPath, { recursive: true, force: true });
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

  it("launches a custom AgentDefinition through the rendered Session Creator selector", async function () {
    if (!shouldRunScenario("custom-agent-rendered-selector")) {
      this.skip();
      return;
    }

    const agentId = `e2e-rendered-selector-custom-${RUN_ID}`;
    const definition = {
      id: agentId,
      name: `E2E Rendered Selector Agent ${RUN_ID}`,
      description:
        "Temporary custom Agent for rendered selector launch coverage.",
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
        "add rendered selector AgentDefinition"
      );
      unwrap(
        await invokeE2E("refreshAgentDefs"),
        "refresh rendered selector AgentDefinition"
      );
      await prepareRenderedCreator({
        account,
        model,
        agentDefinitionId: BUILTIN_SDE_AGENT_ID,
      });
      await selectRenderedAgentDefinition(agentId);
      const sessionId = await sendFromRenderedCreator(
        `E2E rendered custom Agent selector launch ${RUN_ID}. Reply briefly.`
      );
      if (!sessionId) {
        throw new Error(
          "Rendered custom Agent selector launch did not create a session id"
        );
      }
      await waitForSessionAggregateRow(
        sessionId,
        (session) =>
          session.model === model &&
          session.accountId === account.id &&
          session.agentDefinitionId === agentId,
        "rendered custom Agent selector launch metadata"
      );
      unwrap(
        await invokeE2E("openSession", sessionId),
        "open rendered selector session"
      );
      await waitForRenderedSession(sessionId, "custom-agent-rendered-selector");
    } finally {
      await invokeE2E("removeAgentDef", agentId);
    }
  });

  it("launches through the rendered execution mode selector", async function () {
    if (!shouldRunScenario("rendered-mode-selector")) {
      this.skip();
      return;
    }

    await prepareRenderedCreator({
      account,
      model,
      agentDefinitionId: BUILTIN_SDE_AGENT_ID,
    });
    await selectRenderedExecMode("ask");
    const sessionId = await sendFromRenderedCreator(
      `E2E rendered execution mode selector launch ${RUN_ID}. Reply briefly.`
    );
    if (!sessionId) {
      throw new Error(
        "Rendered execution mode selector did not create a session id"
      );
    }
    await waitForSessionAggregateRow(
      sessionId,
      (session) =>
        session.model === model &&
        session.accountId === account.id &&
        session.agentDefinitionId === BUILTIN_SDE_AGENT_ID &&
        session.agentExecMode === "ask",
      "rendered execution mode selector launch metadata"
    );
    unwrap(
      await invokeE2E("openSession", sessionId),
      "open rendered mode selector session"
    );
    await waitForRenderedSession(sessionId, "rendered-mode-selector");
  });

  it("launches a default Agent Org through the rendered Session Creator selector", async function () {
    if (!shouldRunScenario("agent-org-rendered-selector")) {
      this.skip();
      return;
    }

    await prepareRenderedCreator({
      account,
      model,
      agentDefinitionId: BUILTIN_SDE_AGENT_ID,
    });
    await selectRenderedDefaultAgentOrg();
    await selectRenderedExecMode("plan");
    const sessionId = await sendFromRenderedCreator(
      `E2E rendered Agent Org selector launch ${RUN_ID}. Reply briefly.`
    );
    if (!sessionId) {
      throw new Error(
        "Rendered Agent Org selector launch did not create a session id"
      );
    }

    const runState = await waitForAgentOrgRunViewByOrg(
      DEFAULT_AGENT_ORG_ID,
      (view, run) =>
        run?.rootSessionId === sessionId &&
        run?.orgId === DEFAULT_AGENT_ORG_ID &&
        Boolean(view?.context?.runId) &&
        view?.context?.runId === run?.runId &&
        (view?.members ?? []).length > 0,
      "rendered default Agent Org selector runtime view"
    );
    unwrap(
      await invokeE2E("openSession", sessionId),
      "open rendered Agent Org selector root session"
    );
    const renderedState = await waitForRenderedSession(
      sessionId,
      "agent-org-rendered-selector"
    );
    if (renderedState.chatState.activeSession?.agentExecMode !== "plan") {
      throw new Error(
        `Rendered Agent Org selector did not persist plan mode: ${JSON.stringify({ runState, renderedState })}`
      );
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
