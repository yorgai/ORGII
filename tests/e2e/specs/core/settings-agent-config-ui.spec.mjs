/* global describe, before, it */
import {
  E2E_REPO_PATH,
  assertE2ERepoFixture,
  invokeE2E,
  unwrap,
  waitForApp,
} from "../../support/core/agentOrgUiDriver.mjs";

const ROUTE = "/orgii/app/settings/agent-orgs/agents";
const WORKSTATION_ROUTE = "/orgii/workstation/code";
const WAIT_TIMEOUT_MS = 30_000;
const BUILTIN_OS_AGENT_ID = "builtin:os";
const BUILTIN_SDE_AGENT_ID = "builtin:sde";
const BUILTIN_WINGMAN_AGENT_ID = "builtin:wingman";
const RUNTIME_CONFIG_MARKER = `E2E_AGENT_CONFIG_${Date.now()}`;
const CANONICAL_AGENT_TABS = [
  "general",
  "models",
  "subagents",
  "tools",
  "skillsets",
  "rules",
];

async function waitForScript(
  predicateScript,
  label,
  timeout = WAIT_TIMEOUT_MS,
  args = []
) {
  await browser.waitUntil(
    async () => browser.executeScript(predicateScript, args),
    { timeout, interval: 250, timeoutMsg: label }
  );
}

async function pointerClick(selector, label) {
  let point = null;
  await browser.waitUntil(
    async () => {
      point = await browser.executeScript(
        `
          const selector = arguments[0];
          const candidates = [...document.querySelectorAll(selector)].filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          });
          const element = candidates[0] ?? null;
          if (!element) {
            return { found: false, selector, bodyText: document.body.innerText.slice(0, 2000) };
          }
          element.scrollIntoView({ block: "center", inline: "center" });
          const rect = element.getBoundingClientRect();
          const x = Math.floor(rect.left + rect.width / 2);
          const y = Math.floor(rect.top + rect.height / 2);
          const hit = document.elementFromPoint(x, y);
          const hitMatches = !!hit?.closest?.(selector);
          return {
            found: true,
            selector,
            x,
            y,
            rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
            hitMatches,
            hit: hit ? {
              tag: hit.tagName,
              className: typeof hit.className === "string" ? hit.className : null,
              testId: hit.getAttribute?.("data-testid") || null,
              dataTabKey: hit.getAttribute?.("data-tab-key") || null,
              text: (hit.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 180),
            } : null,
            text: (element.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 180),
          };
        `,
        [selector]
      );
      return point?.found === true && point?.hitMatches === true;
    },
    {
      timeout: WAIT_TIMEOUT_MS,
      interval: 250,
      timeoutMsg: `${label} not clickable: ${JSON.stringify(point, null, 2)}`,
    }
  );
  await browser
    .action("pointer")
    .move({ x: point.x, y: point.y })
    .down()
    .up()
    .perform();
  return point;
}

function agentConfigVariantFor(agentId) {
  if (agentId === BUILTIN_OS_AGENT_ID) return "builtin-os";
  if (agentId === BUILTIN_SDE_AGENT_ID) return "builtin-sde";
  if (agentId === BUILTIN_WINGMAN_AGENT_ID) return "wingman";
  return "custom";
}

async function openAgentDetail(agentId, label) {
  unwrap(await invokeE2E("navigateTo", ROUTE), `navigate to ${label}`);
  await waitForScript(
    `return !!document.querySelector('[data-testid="agent-orgs-agent-row-${agentId}"]');`,
    `${label} row did not render after navigating to Agent settings`
  );
  await pointerClick(
    `[data-testid="agent-orgs-agent-row-${agentId}"]`,
    `${label} row`
  );
  unwrap(await invokeE2E("openAgentTab", agentId, "general"), `open ${label} agent tab`);
  unwrap(await invokeE2E("navigateTo", WORKSTATION_ROUTE), `navigate to ${label} workstation config`);

  const variant = agentConfigVariantFor(agentId);
  await waitForScript(
    `
      const element = document.querySelector(arguments[0]);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    `,
    `${label} agent-config tab did not become visible`,
    WAIT_TIMEOUT_MS,
    [`[data-testid="agent-config-tab-${variant}-${agentId}"]`]
  );
}

async function assertTabActive(tabKey) {
  await waitForScript(
    `
      const selector = arguments[0];
      const elements = [...document.querySelectorAll(selector)].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
      return elements.some((element) => element.className.includes("font-semibold"));
    `,
    `${tabKey} tab did not become active`,
    WAIT_TIMEOUT_MS,
    [`[data-testid="agent-orgs-detail-tab-${tabKey}"]`]
  );
}

async function clickAgentTab(tabKey) {
  await pointerClick(
    `[data-testid="agent-orgs-detail-tab-${tabKey}"]`,
    `${tabKey} tab`
  );
  await assertTabActive(tabKey);
}

async function clickSwitchAndWait(selector, label) {
  await browser.waitUntil(
    async () =>
      browser.executeScript(
        `
          const element = document.querySelector(arguments[0]);
          if (!element) return false;
          const state = element.getAttribute("aria-checked");
          return (state === "true" || state === "false") && !element.disabled;
        `,
        [selector]
      ),
    {
      timeout: WAIT_TIMEOUT_MS,
      interval: 250,
      timeoutMsg: `${label} did not become an enabled switch`,
    }
  );
  const before = await browser.executeScript(
    `return document.querySelector(arguments[0])?.getAttribute("aria-checked") ?? null;`,
    [selector]
  );
  if (before !== "true" && before !== "false") {
    throw new Error(`${label} did not expose switch state: ${before}`);
  }
  await pointerClick(selector, label);
  await browser.waitUntil(
    async () => {
      const current = await browser.executeScript(
        `return document.querySelector(arguments[0])?.getAttribute("aria-checked") ?? null;`,
        [selector]
      );
      return current !== before && (current === "true" || current === "false");
    },
    { timeout: 10_000, interval: 200, timeoutMsg: `${label} did not toggle` }
  );
  return before === "true" ? false : true;
}

function assertIncludes(arrayValue, expected, label) {
  if (!Array.isArray(arrayValue) || !arrayValue.includes(expected)) {
    throw new Error(
      `${label} missing ${expected}: ${JSON.stringify(arrayValue)}`
    );
  }
}

function assertNotIncludes(arrayValue, unexpected, label) {
  if (Array.isArray(arrayValue) && arrayValue.includes(unexpected)) {
    throw new Error(
      `${label} unexpectedly included ${unexpected}: ${JSON.stringify(arrayValue)}`
    );
  }
}

async function listAccounts() {
  return unwrap(await invokeE2E("listAccounts"), "listAccounts").accounts;
}

async function invokeSnapshot(helperName, sessionId, label) {
  let lastError = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await invokeE2E(helperName, sessionId);
    if (result?.ok) {
      return result;
    }
    lastError = result?.error ?? JSON.stringify(result);
    await browser.pause(500);
  }
  throw new Error(`${label} snapshot did not become available: ${lastError}`);
}

async function cleanupStaleE2EAgentDefs() {
  const result = unwrap(
    await invokeE2E("listAgentDefs"),
    "list agent definitions for stale E2E cleanup"
  );
  const defs = Array.isArray(result.defs) ? result.defs : [];
  for (const definition of defs) {
    const id = String(definition?.id ?? "");
    if (
      id.startsWith("e2e-ui-settings-") ||
      id.startsWith("e2e-parent-") ||
      id.startsWith("e2e-child-") ||
      id.includes("E2E_AGENT_CONFIG_")
    ) {
      await invokeE2E("removeAgentDef", id);
    }
  }
  await refreshAgentRows();
}

function selectRuntimeAccount(accounts) {
  const candidates = accounts.filter(
    (account) =>
      account.enabled &&
      account.supports_rust_agents &&
      (account.has_api_key || account.has_session_token) &&
      (account.enabled_models ?? []).length > 0
  );
  return (
    candidates.find((account) => account.agent_type === "codex") ??
    candidates.find((account) => account.agent_type === "openai_api") ??
    candidates[0]
  );
}

function selectModel(account) {
  const models = account?.enabled_models ?? [];
  if (models.length === 0) {
    throw new Error(
      `Account has no enabled models: ${JSON.stringify(account)}`
    );
  }
  return models[0];
}

async function refreshAgentRows() {
  unwrap(await invokeE2E("refreshAgentDefs"), "refresh agent definitions");
}

async function setTextInput(selector, value, label) {
  const targetId = `e2e-input-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await waitForScript(
    `
      const selector = arguments[0];
      const targetId = arguments[1];
      document.querySelectorAll("[data-e2e-input-target]").forEach((element) => {
        element.removeAttribute("data-e2e-input-target");
      });
      const element = [...document.querySelectorAll(selector)].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const style = window.getComputedStyle(candidate);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          (candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement) &&
          !candidate.disabled &&
          !candidate.readOnly
        );
      });
      if (!element) return false;
      element.setAttribute("data-e2e-input-target", targetId);
      return true;
    `,
    `${label} missing or disabled`,
    WAIT_TIMEOUT_MS,
    [selector, targetId]
  );

  await browser.executeScript(
    `
      const targetId = arguments[0];
      const value = arguments[1];
      const element = document.querySelector(
        '[data-e2e-input-target="' + CSS.escape(targetId) + '"]'
      );
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        throw new Error("target input disappeared");
      }
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      element.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
      descriptor?.set?.call(element, value);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      element.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
      return element.value;
    `,
    [targetId, String(value)]
  );
  await browser.waitUntil(
    async () =>
      browser.executeScript(
        `
          const targetId = arguments[0];
          const expected = arguments[1];
          const element = document.querySelector(
            '[data-e2e-input-target="' + CSS.escape(targetId) + '"]'
          );
          if (!element) return false;
          if (element.value === expected) return true;
          const numericActual = Number(String(element.value).replace(/,/g, ""));
          const numericExpected = Number(expected);
          return expected.trim() !== "" && !Number.isNaN(numericActual) && !Number.isNaN(numericExpected) && numericActual === numericExpected;
        `,
        [targetId, String(value)]
      ),
    {
      timeout: 10_000,
      interval: 200,
      timeoutMsg: `${label} did not reflect typed value`,
    }
  );
}

async function setNumberInput(selector, value, label) {
  await setTextInput(selector, String(value), label);
}

async function waitForAgentDefField(agentId, predicate, label) {
  let lastDefinition = null;
  let lastNonNullDefinition = null;
  await browser.waitUntil(
    async () => {
      const definition = unwrap(
        await invokeE2E("getAgentDef", agentId),
        `poll ${label}`
      ).def;
      lastDefinition = definition;
      if (definition) lastNonNullDefinition = definition;
      return predicate(definition);
    },
    {
      timeout: 20_000,
      interval: 500,
      timeoutMsg: `${label} did not persist. Last=${JSON.stringify(lastDefinition)} LastNonNull=${JSON.stringify(lastNonNullDefinition)}`,
    }
  );
  return lastDefinition ?? lastNonNullDefinition;
}

function expectDefinitionField(definition, predicate, label) {
  if (!predicate(definition)) {
    throw new Error(`${label} mismatch in definition: ${JSON.stringify(definition)}`);
  }
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`
    );
  }
}

describe("Settings Agent configuration UI", () => {
  before(async () => {
    assertE2ERepoFixture();
    await waitForApp();
    await browser.executeScript(
      `
        localStorage.setItem("orgii:auth_skipped", "1");
        return true;
      `,
      []
    );
    await cleanupStaleE2EAgentDefs();
  });

  it("opens built-in Agent configuration tabs without covered click targets", async () => {
    await openAgentDetail(BUILTIN_OS_AGENT_ID, "OS Agent");

    await waitForScript(
      `return !!document.querySelector('[data-testid="agent-orgs-builtin-detail-os"]');`,
      "OS Agent detail panel did not open"
    );

    for (const tabKey of CANONICAL_AGENT_TABS) {
      await clickAgentTab(tabKey);
    }

    await openAgentDetail(BUILTIN_SDE_AGENT_ID, "SDE Agent");
    await waitForScript(
      `return !!document.querySelector('[data-testid="agent-orgs-builtin-detail-sde"]');`,
      "SDE Agent detail panel did not open"
    );

    for (const tabKey of CANONICAL_AGENT_TABS) {
      await clickAgentTab(tabKey);
    }
  });

  it("persists workspace Skills and Rules switches from UI to agent definition", async () => {
    await openAgentDetail(BUILTIN_SDE_AGENT_ID, "SDE Agent");

    const beforeDefinition = unwrap(
      await invokeE2E("getAgentDef", BUILTIN_SDE_AGENT_ID),
      "get SDE Agent definition before switch test"
    ).def;

    await clickAgentTab("skillsets");
    const loadWorkspaceResources = await clickSwitchAndWait(
      '[data-testid="agent-orgs-load-workspace-resources-switch"]',
      "load workspace resources switch"
    );
    await browser.waitUntil(
      async () => {
        const definition = unwrap(
          await invokeE2E("getAgentDef", BUILTIN_SDE_AGENT_ID),
          "poll SDE Agent loadWorkspaceResources"
        ).def;
        return definition.loadWorkspaceResources === loadWorkspaceResources;
      },
      {
        timeout: 15_000,
        interval: 500,
        timeoutMsg:
          "loadWorkspaceResources did not persist to agent definition",
      }
    );

    await clickAgentTab("rules");
    const loadWorkspaceRules = await clickSwitchAndWait(
      '[data-testid="agent-orgs-load-workspace-rules-switch"]',
      "load workspace rules switch"
    );
    await browser.waitUntil(
      async () => {
        const definition = unwrap(
          await invokeE2E("getAgentDef", BUILTIN_SDE_AGENT_ID),
          "poll SDE Agent loadWorkspaceRules"
        ).def;
        return definition.loadWorkspaceRules === loadWorkspaceRules;
      },
      {
        timeout: 15_000,
        interval: 500,
        timeoutMsg: "loadWorkspaceRules did not persist to agent definition",
      }
    );

    unwrap(
      await invokeE2E("updateAgentDefPatch", BUILTIN_SDE_AGENT_ID, {
        loadWorkspaceResources: beforeDefinition.loadWorkspaceResources ?? true,
        loadWorkspaceRules: beforeDefinition.loadWorkspaceRules ?? true,
      }),
      "restore SDE Agent workspace toggles"
    );
  });

  it("persists Wingman Desktop Safety switches from Settings UI to desktop config", async () => {
    const beforeConfig = unwrap(
      await invokeE2E("getDesktopConfig"),
      "get desktop config before Settings UI test"
    ).config;

    try {
      await openAgentDetail(BUILTIN_WINGMAN_AGENT_ID, "Wingman Agent");
      await waitForScript(
        `return !!document.querySelector('[data-testid="agent-orgs-custom-detail"]');`,
        "Wingman detail panel did not open"
      );
      await clickAgentTab("safety");

      const hideBeforeAction = await clickSwitchAndWait(
        '[data-testid="agent-orgs-desktop-safety-hideBeforeAction-switch"]',
        "desktop safety hide-before-action switch"
      );
      const antiDetection = await clickSwitchAndWait(
        '[data-testid="agent-orgs-desktop-safety-antiDetection-switch"]',
        "desktop safety anti-detection switch"
      );

      await browser.waitUntil(
        async () => {
          const current = unwrap(
            await invokeE2E("getDesktopConfig"),
            "poll desktop config after Settings UI switches"
          ).config;
          return (
            current.hideBeforeAction === hideBeforeAction &&
            current.antiDetection === antiDetection
          );
        },
        {
          timeout: 15_000,
          interval: 500,
          timeoutMsg: "Desktop Safety switches did not persist to desktop config",
        }
      );
    } finally {
      unwrap(
        await invokeE2E("setDesktopConfig", beforeConfig),
        "restore desktop config after Settings UI test"
      );
    }
  });

  it("writes custom Agent Settings controls from rendered UI into AgentDefinition", async () => {
    const agentId = `e2e-ui-settings-${RUNTIME_CONFIG_MARKER}`;
    const mcpServerName = `e2e-mcp-${RUNTIME_CONFIG_MARKER}`;
    const mcpToolName = `e2e_tool_${RUNTIME_CONFIG_MARKER.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    const mcpToolKey = `mcp__${mcpServerName}__${mcpToolName}`;
    const ruleName = `e2e-rule-${RUNTIME_CONFIG_MARKER}`;
    let originalMcpConfig = null;
    const initialDefinition = {
      id: agentId,
      name: `E2E UI Settings ${RUNTIME_CONFIG_MARKER}`,
      description: "Temporary E2E custom agent for rendered Settings controls.",
      builtIn: false,
      tier: "primary",
      inheritsFrom: BUILTIN_SDE_AGENT_ID,
      capabilities: { coding: { modeSwitch: true } },
      delegationConfig: { delegatable: true, contextBuilders: [] },
      sessionModel: {
        mode: "singleton",
        processingLock: true,
        maxIterations: 5,
        compaction: {
          enabled: true,
          triggerRatio: 0.8,
        },
      },
      contextWindow: 128_000,
      maxTokens: 8_192,
      temperature: 0.7,
      execTimeout: 120,
      maxToolUseConcurrency: 10,
      agentPolicy: {
        autonomy: "full",
        workspaceOnly: true,
        blockedCommands: [],
        riskRules: { medium: [], high: [] },
      },
      tools: { userAllowedTools: [], excludedTools: [] },
      skillsConfig: { enabled: true, include: [], exclude: [], sourceDirs: [] },
      soulContent: `Initial soul ${RUNTIME_CONFIG_MARKER}`,
    };

    try {
      originalMcpConfig = unwrap(
        await invokeE2E("mcpGetConfig", "global"),
        "get original MCP config for Agent Settings UI test"
      ).config;
      unwrap(
        await invokeE2E(
          "mcpUpdateServers",
          {
            mcpServers: {
              ...(originalMcpConfig.mcpServers ?? {}),
              [mcpServerName]: {
                type: "stdio",
                command: "node",
                args: [
                  "-e",
                  `const toolName = ${JSON.stringify(mcpToolName)};
let buffer = "";
function send(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\\r?\\n/);
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "orgii-e2e-mcp", version: "1.0.0" } } });
    } else if (request.method === "tools/list") {
      send({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: toolName, description: "E2E MCP tool", inputSchema: { type: "object", properties: {} } }] } });
    } else if (request.method === "tools/call") {
      send({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "ok" }] } });
    } else if (request.id !== undefined) {
      send({ jsonrpc: "2.0", id: request.id, result: {} });
    }
  }
});`
                ],
                disabled: false,
                timeout: 5,
              },
            },
          },
          "global"
        ),
        "seed MCP server for Agent Settings UI test"
      );
      unwrap(
        await invokeE2E("createPolicy", {
          name: ruleName,
          content: `# ${ruleName}\n\nE2E rule content ${RUNTIME_CONFIG_MARKER}`,
          source: "personal",
          agents: [],
          scopeRepoPaths: null,
          scopeExcludeRepoPaths: null,
        }),
        "seed policy for Agent Settings UI test"
      );
      unwrap(
        await invokeE2E("addAgentDef", initialDefinition),
        "add rendered UI settings agent definition"
      );
      await waitForAgentDefField(
        agentId,
        (definition) => definition?.id === agentId,
        "rendered UI settings agent immediately after add"
      );
      await refreshAgentRows();
      await openAgentDetail(agentId, "E2E rendered UI settings custom Agent");
      await waitForScript(
        `
          const elements = [...document.querySelectorAll('[data-testid="agent-orgs-custom-detail"]')];
          return elements.some((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          });
        `,
        "custom Agent detail panel did not open"
      );
      await clickAgentTab("general");

      await setTextInput(
        '[data-testid="agent-orgs-custom-name-input"]',
        `E2E UI Settings Edited ${RUNTIME_CONFIG_MARKER}`,
        "custom Agent name"
      );
      await setTextInput(
        '[data-testid="agent-orgs-custom-description-input"]',
        `Edited rendered description ${RUNTIME_CONFIG_MARKER}`,
        "custom Agent description"
      );
      await setNumberInput(
        '[data-testid="agent-orgs-runtime-max-iterations-input"]',
        7,
        "max iterations"
      );
      await setNumberInput(
        '[data-testid="agent-orgs-runtime-exec-timeout-input"]',
        135,
        "exec timeout"
      );
      const workspaceOnly = await clickSwitchAndWait(
        '[data-testid="agent-orgs-security-workspace-only-switch"]',
        "security workspace-only switch"
      );
      const blockListCommand = `e2e-deny-${RUNTIME_CONFIG_MARKER}`;
      const alwaysAskCommand = `e2e-ask-${RUNTIME_CONFIG_MARKER}`;
      await setTextInput(
        '[data-testid="agent-orgs-security-block-list-textarea"]',
        blockListCommand,
        "security block-list textarea"
      );
      await pointerClick(
        '[data-testid="agent-orgs-security-block-list-save-button"]',
        "security block-list save button"
      );
      await setTextInput(
        '[data-testid="agent-orgs-security-always-ask-textarea"]',
        alwaysAskCommand,
        "security always-ask textarea"
      );
      await pointerClick(
        '[data-testid="agent-orgs-security-always-ask-save-button"]',
        "security always-ask save button"
      );

      await clickAgentTab("models");
      await setNumberInput(
        '[data-testid="agent-orgs-model-context-window-input"]',
        64_000,
        "context window"
      );
      await setNumberInput(
        '[data-testid="agent-orgs-model-max-tokens-input"]',
        4_096,
        "max tokens"
      );
      await setNumberInput(
        '[data-testid="agent-orgs-model-temperature-input"]',
        0.3,
        "temperature"
      );
      await setNumberInput(
        '[data-testid="agent-orgs-model-compaction-trigger-ratio-input"]',
        0.65,
        "compaction trigger ratio"
      );
      await setNumberInput(
        '[data-testid="agent-orgs-model-reliability-max-retries-input"]',
        4,
        "reliability max retries"
      );
      await setNumberInput(
        '[data-testid="agent-orgs-model-reliability-base-backoff-input"]',
        750,
        "reliability base backoff"
      );

      await clickAgentTab("subagents");
      await setNumberInput(
        '[data-testid="agent-orgs-subagents-max-tool-use-concurrency-input"]',
        6,
        "max tool-use concurrency"
      );

      await clickAgentTab("tools");
      const toggledToolName = await browser.waitUntil(
        async () =>
          browser.executeScript(
            `
              const switchElement = document.querySelector('[data-testid^="agent-orgs-tool-switch-"]');
              if (!switchElement) return null;
              const testId = switchElement.getAttribute("data-testid") ?? "";
              return testId.replace("agent-orgs-tool-switch-", "");
            `,
            []
          ),
        {
          timeout: WAIT_TIMEOUT_MS,
          interval: 250,
          timeoutMsg: "tool switch did not render for custom Agent",
        }
      );
      await clickSwitchAndWait(
        `[data-testid="agent-orgs-tool-switch-${toggledToolName}"]`,
        `tool switch ${toggledToolName}`
      );

      await clickAgentTab("skillsets");
      const toggledSkillName = await browser.waitUntil(
        async () =>
          browser.executeScript(
            `
              const switchElement = document.querySelector('[data-testid^="agent-orgs-skill-switch-"]');
              if (!switchElement) return null;
              const testId = switchElement.getAttribute("data-testid") ?? "";
              return testId.replace("agent-orgs-skill-switch-", "");
            `,
            []
          ),
        {
          timeout: WAIT_TIMEOUT_MS,
          interval: 250,
          timeoutMsg: "skill switch did not render for custom Agent",
        }
      );
      await clickSwitchAndWait(
        `[data-testid="agent-orgs-skill-switch-${toggledSkillName}"]`,
        `skill switch ${toggledSkillName}`
      );
      await waitForAgentDefField(
        agentId,
        (definition) => definition?.id === agentId,
        "rendered UI settings agent after Skill switch"
      );
      await browser.waitUntil(
        async () => {
          const tools = unwrap(
            await invokeE2E("mcpListServerTools", mcpServerName),
            `poll MCP tools for ${mcpServerName}`
          ).tools;
          return tools.some((tool) => tool.name === mcpToolName);
        },
        {
          timeout: WAIT_TIMEOUT_MS,
          interval: 500,
          timeoutMsg: "seeded MCP server did not expose its E2E tool",
        }
      );
      await pointerClick(
        `[data-testid="agent-orgs-mcp-server-row-${mcpServerName}"]`,
        `MCP server row ${mcpServerName}`
      );
      await clickSwitchAndWait(
        `[data-testid="agent-orgs-mcp-tool-switch-${mcpServerName}-${mcpToolName}"]`,
        `MCP tool switch ${mcpToolName}`
      );
      await waitForAgentDefField(
        agentId,
        (definition) =>
          (definition?.tools?.disabledMcpTools ?? []).includes(mcpToolKey),
        "rendered UI settings agent disabled MCP tool after MCP tool switch"
      );
      await clickSwitchAndWait(
        `[data-testid="agent-orgs-mcp-server-switch-${mcpServerName}"]`,
        `MCP server switch ${mcpServerName}`
      );
      await waitForAgentDefField(
        agentId,
        (definition) =>
          (definition?.tools?.disabledMcpServers ?? []).includes(mcpServerName),
        "rendered UI settings agent disabled MCP server after MCP server switch"
      );

      await clickAgentTab("rules");
      await clickSwitchAndWait(
        `[data-testid="agent-orgs-rule-switch-personal-${ruleName}"]`,
        `rule switch ${ruleName}`
      );
      await browser.waitUntil(
        async () => {
          const policies = unwrap(
            await invokeE2E("listPolicies"),
            "poll policy after rendered Rules switch"
          ).policies;
          const policy = policies.find(
            (item) => item.name === ruleName && item.source === "personal"
          );
          return policy?.enabled === false;
        },
        {
          timeout: 15_000,
          interval: 500,
          timeoutMsg: "rendered Rules switch did not persist to policies store",
        }
      );
      await waitForAgentDefField(
        agentId,
        (definition) => definition?.id === agentId,
        "rendered UI settings agent after Rules switch"
      );

      const stored = await waitForAgentDefField(
        agentId,
        (definition) => definition?.id === agentId,
        "rendered UI custom Agent Settings controls"
      );

      expectDefinitionField(
        stored,
        (definition) =>
          definition.name === `E2E UI Settings Edited ${RUNTIME_CONFIG_MARKER}`,
        "custom Agent name"
      );
      expectDefinitionField(
        stored,
        (definition) =>
          definition.description ===
          `Edited rendered description ${RUNTIME_CONFIG_MARKER}`,
        "custom Agent description"
      );
      expectDefinitionField(
        stored,
        (definition) => definition.sessionModel?.maxIterations === 7,
        "max iterations"
      );
      expectDefinitionField(
        stored,
        (definition) => definition.execTimeout === 135,
        "exec timeout"
      );
      expectDefinitionField(
        stored,
        (definition) => definition.agentPolicy?.workspaceOnly === workspaceOnly,
        "workspace-only"
      );
      expectDefinitionField(
        stored,
        (definition) =>
          (definition.agentPolicy?.riskRules?.high ?? []).includes(blockListCommand),
        "security block-list command"
      );
      expectDefinitionField(
        stored,
        (definition) =>
          (definition.agentPolicy?.riskRules?.medium ?? []).includes(alwaysAskCommand),
        "security always-ask command"
      );
      expectDefinitionField(
        stored,
        (definition) => definition.contextWindow === 64_000,
        "context window"
      );
      expectDefinitionField(
        stored,
        (definition) => definition.maxTokens === 4_096,
        "max tokens"
      );
      expectDefinitionField(
        stored,
        (definition) => definition.temperature === 0.3,
        "temperature"
      );
      expectDefinitionField(
        stored,
        (definition) => definition.sessionModel?.compaction?.triggerRatio === 0.65,
        "compaction trigger ratio"
      );
      expectDefinitionField(
        stored,
        (definition) => definition.reliability?.maxRetries === 4,
        "reliability max retries"
      );
      expectDefinitionField(
        stored,
        (definition) => definition.reliability?.baseBackoffMs === 750,
        "reliability base backoff"
      );
      expectDefinitionField(
        stored,
        (definition) => definition.maxToolUseConcurrency === 6,
        "max tool-use concurrency"
      );
      expectDefinitionField(
        stored,
        (definition) =>
          (definition.tools?.excludedTools ?? []).includes(toggledToolName),
        "excluded tool"
      );
      expectDefinitionField(
        stored,
        (definition) =>
          (definition.skillsConfig?.exclude ?? []).includes(toggledSkillName),
        "excluded skill"
      );
      expectDefinitionField(
        stored,
        (definition) =>
          (definition.tools?.disabledMcpServers ?? []).includes(mcpServerName),
        "disabled MCP server"
      );
      expectDefinitionField(
        stored,
        (definition) =>
          (definition.tools?.disabledMcpTools ?? []).includes(mcpToolKey),
        "disabled MCP tool"
      );

      expectEqual(
        stored.sessionModel?.mode,
        "singleton",
        "sessionModel mode preserved after partial UI edits"
      );
      expectEqual(
        stored.sessionModel?.processingLock,
        true,
        "sessionModel processingLock preserved after partial UI edits"
      );
      expectEqual(
        stored.sessionModel?.compaction?.enabled,
        true,
        "compaction enabled preserved after nested UI edit"
      );
      expectEqual(
        stored.agentPolicy?.autonomy,
        "full",
        "security autonomy preserved after workspace toggle"
      );
    } finally {
      await invokeE2E("removeAgentDef", agentId);
      await invokeE2E("deletePolicy", ruleName, "personal");
      if (originalMcpConfig) {
        await invokeE2E("mcpUpdateServers", originalMcpConfig, "global");
      }
      await refreshAgentRows();
    }
  });

  it("launches a custom Agent and proves General/Models/Subagents/Tools/Skills settings reach runtime", async () => {
    const accounts = await listAccounts();
    const account = selectRuntimeAccount(accounts);
    if (!account) {
      throw new Error(
        `No enabled account with usable key/token and enabled models for runtime config E2E. Accounts=${JSON.stringify(accounts)}`
      );
    }
    const model = selectModel(account);
    const allTools = unwrap(
      await invokeE2E("listAllTools"),
      "listAllTools"
    ).tools;
    const toolNames = allTools
      .map((tool) => tool.name ?? tool.id)
      .filter((name) => typeof name === "string" && name.length > 0);
    const restrictedTool = toolNames.includes("Read") ? "Read" : toolNames[0];
    const excludedTool = toolNames.includes("Exec") ? "Exec" : toolNames[1];
    if (!restrictedTool || !excludedTool) {
      throw new Error(
        `Need at least two registered tools for tools runtime E2E: ${JSON.stringify(allTools)}`
      );
    }

    const parentAgentId = `e2e-parent-${RUNTIME_CONFIG_MARKER}`;
    const childAgentId = `e2e-child-${RUNTIME_CONFIG_MARKER}`;
    const soulContent = `E2E runtime soul marker ${RUNTIME_CONFIG_MARKER}`;
    const skillInclude = [`e2e-include-${RUNTIME_CONFIG_MARKER}`];
    const skillExclude = [`e2e-exclude-${RUNTIME_CONFIG_MARKER}`];
    const fallbackModel = `${model}-fallback-e2e`;

    const baseChildDefinition = {
      id: childAgentId,
      name: `E2E Child ${RUNTIME_CONFIG_MARKER}`,
      description: "Temporary E2E child agent for sub-agent runtime wiring.",
      builtIn: false,
      tier: "secondary",
      inheritsFrom: BUILTIN_SDE_AGENT_ID,
      capabilities: { coding: { modeSwitch: true } },
      delegationConfig: { delegatable: true, contextBuilders: [] },
      sessionModel: {
        mode: "singleton",
        processingLock: true,
        maxIterations: 2,
      },
      tools: { userAllowedTools: [], excludedTools: [] },
      skillsConfig: { enabled: true, include: [], exclude: [], sourceDirs: [] },
      soulContent: `E2E child soul ${RUNTIME_CONFIG_MARKER}`,
    };
    const parentDefinition = {
      id: parentAgentId,
      name: `E2E Parent ${RUNTIME_CONFIG_MARKER}`,
      description: "Temporary E2E parent agent for config runtime wiring.",
      builtIn: false,
      tier: "primary",
      inheritsFrom: BUILTIN_SDE_AGENT_ID,
      capabilities: { coding: { modeSwitch: true } },
      agentPolicy: {
        autonomy: "full",
        workspaceOnly: true,
        blockedCommands: [`e2e-blocked-${RUNTIME_CONFIG_MARKER}`],
        riskRules: {
          medium: [`e2e-ask-${RUNTIME_CONFIG_MARKER}`],
          high: [`e2e-block-${RUNTIME_CONFIG_MARKER}`],
        },
      },
      delegationConfig: { delegatable: true, contextBuilders: [] },
      sessionModel: {
        mode: "singleton",
        processingLock: true,
        maxIterations: 3,
      },
      contextWindow: 12_345,
      maxTokens: 2_345,
      temperature: 0.42,
      execTimeout: 91,
      maxToolUseConcurrency: 4,
      subAgents: [{ agentId: childAgentId, isolation: "worktree" }],
      tools: {
        systemRestrictToTools: [restrictedTool],
        userAllowedTools: [excludedTool],
        excludedTools: [excludedTool],
        disabledMcpServers: ["e2e-disabled-server"],
        disabledMcpTools: ["e2e-disabled-tool"],
      },
      loadWorkspaceResources: false,
      loadWorkspaceRules: false,
      skillsConfig: {
        enabled: true,
        include: skillInclude,
        exclude: skillExclude,
        sourceDirs: [],
      },
      selectedAccountId: account.id,
      selectedModelId: model,
      reliability: {
        maxRetries: 1,
        baseBackoffMs: 10,
        fallbackModels: [fallbackModel],
      },
      soulContent,
    };

    try {
      unwrap(
        await invokeE2E("addAgentDef", baseChildDefinition),
        "add E2E child agent definition"
      );
      unwrap(
        await invokeE2E("addAgentDef", parentDefinition),
        "add E2E parent agent definition"
      );

      const storedParent = unwrap(
        await invokeE2E("getAgentDef", parentAgentId),
        "get E2E parent agent definition"
      ).def;
      if (storedParent.soulContent !== soulContent) {
        throw new Error(
          `Parent definition did not persist before launch: ${JSON.stringify(storedParent)}`
        );
      }

      unwrap(
        await invokeE2E("navigateTo", WORKSTATION_ROUTE),
        "navigate to workstation"
      );
      const launch = unwrap(
        await invokeE2E("launchSession", {
          category: "rust_agent",
          content: `E2E runtime config ${RUNTIME_CONFIG_MARKER}. Reply with one short sentence.`,
          workspacePath: E2E_REPO_PATH,
          keySource: "own_key",
          accountId: account.id,
          model,
          agentDefinitionId: parentAgentId,
          background: false,
        }),
        "launch runtime config session"
      ).result;
      const sessionId = launch?.sessionId ?? launch?.session_id;
      if (!sessionId) {
        throw new Error(
          `Runtime config launch did not create a session id: ${JSON.stringify(launch)}`
        );
      }

      const general = unwrap(
        await invokeSnapshot(
          "debugSessionGeneralSnapshot",
          sessionId,
          "General"
        ),
        "debugSessionGeneralSnapshot"
      ).snapshot;
      if (general.agentId !== parentAgentId) {
        throw new Error(
          `General snapshot agent mismatch: ${JSON.stringify(general)}`
        );
      }
      if (
        general.definitionSoulContent !== soulContent ||
        general.runtimeAgentSoul !== soulContent
      ) {
        throw new Error(
          `Soul content did not reach runtime: ${JSON.stringify(general)}`
        );
      }
      if (
        general.definitionMaxIterations !== 3 ||
        general.resolvedMaxIterations !== 3
      ) {
        throw new Error(
          `Max iterations did not reach runtime: ${JSON.stringify(general)}`
        );
      }
      if (
        general.definitionExecTimeout !== 91 ||
        general.resolvedExecTimeoutSecs !== 91
      ) {
        throw new Error(
          `Exec timeout did not reach runtime: ${JSON.stringify(general)}`
        );
      }

      const modelSnapshot = unwrap(
        await invokeSnapshot("debugSessionModelSnapshot", sessionId, "Models"),
        "debugSessionModelSnapshot"
      ).snapshot;
      if (
        modelSnapshot.activeModel !== model ||
        modelSnapshot.activeAccountId !== account.id
      ) {
        throw new Error(
          `Model/account did not reach runtime: ${JSON.stringify(modelSnapshot)}`
        );
      }
      if (modelSnapshot.resolvedSelectedModelId !== model) {
        throw new Error(
          `Selected model did not resolve: ${JSON.stringify(modelSnapshot)}`
        );
      }
      assertIncludes(
        modelSnapshot.fallbackModels,
        fallbackModel,
        "fallbackModels"
      );

      const subagents = unwrap(
        await invokeSnapshot(
          "debugSessionSubagentSnapshot",
          sessionId,
          "Subagents"
        ),
        "debugSessionSubagentSnapshot"
      ).snapshot;
      assertIncludes(
        subagents.resolvedSubAgents.map((entry) => entry.agentId),
        childAgentId,
        "resolved sub-agents"
      );
      assertIncludes(
        subagents.allowedSubagents,
        childAgentId,
        "allowed sub-agents"
      );
      assertIncludes(
        subagents.llmVisibleAgentIds,
        childAgentId,
        "LLM-visible sub-agents"
      );

      const tools = unwrap(
        await invokeSnapshot("debugSessionToolsSnapshot", sessionId, "Tools"),
        "debugSessionToolsSnapshot"
      ).snapshot;
      assertIncludes(
        tools.definitionSystemRestrictToTools,
        restrictedTool,
        "definition restrict tools"
      );
      assertIncludes(
        tools.definitionUserAllowedTools,
        excludedTool,
        "definition user allowed tools"
      );
      assertIncludes(
        tools.definitionExcludedTools,
        excludedTool,
        "definition excluded tools"
      );
      assertIncludes(
        tools.resolvedRestrictTo,
        restrictedTool,
        "resolved restrict tools"
      );
      assertIncludes(
        tools.resolvedDisabledMcpServers,
        "e2e-disabled-server",
        "disabled MCP servers"
      );
      assertIncludes(
        tools.resolvedDisabledMcpTools,
        "e2e-disabled-tool",
        "disabled MCP tools"
      );
      assertIncludes(
        tools.promptToolNames,
        restrictedTool,
        "policy-filtered prompt tools"
      );
      assertNotIncludes(
        tools.promptToolNames,
        excludedTool,
        "policy-filtered prompt tools"
      );

      const security = unwrap(
        await invokeSnapshot(
          "debugSessionSecuritySnapshot",
          sessionId,
          "Security"
        ),
        "debugSessionSecuritySnapshot"
      ).snapshot;
      if (!security.workspaceOnly) {
        throw new Error(
          `Security workspace-only policy did not reach runtime: ${JSON.stringify(security)}`
        );
      }
      assertIncludes(
        security.blockedCommands,
        `e2e-blocked-${RUNTIME_CONFIG_MARKER}`,
        "runtime blocked commands"
      );
      assertIncludes(
        security.mediumRiskRules,
        `e2e-ask-${RUNTIME_CONFIG_MARKER}`,
        "runtime medium risk rules"
      );
      assertIncludes(
        security.highRiskRules,
        `e2e-block-${RUNTIME_CONFIG_MARKER}`,
        "runtime high risk rules"
      );
      const blockedValidation = unwrap(
        await invokeE2E(
          "debugSessionValidateCommand",
          sessionId,
          `e2e-blocked-${RUNTIME_CONFIG_MARKER}`,
          false
        ),
        "debugSessionValidateCommand blocked command"
      ).validation;
      if (blockedValidation.outcome !== "denied") {
        throw new Error(
          `Blocked command was not denied by runtime policy: ${JSON.stringify(blockedValidation)}`
        );
      }

      const promptDump = unwrap(
        await invokeSnapshot("promptDump", sessionId, "Prompt"),
        "promptDump"
      ).dump;
      if (
        promptDump.loadWorkspaceResources !== false ||
        promptDump.loadWorkspaceRules !== false
      ) {
        throw new Error(
          `Workspace resource/rule flags did not reach prompt config: ${JSON.stringify(promptDump)}`
        );
      }
      const rulesTrace = promptDump.sections?.find(
        (section) => section.sectionId === "rules"
      );
      if (rulesTrace?.content?.includes(".orgii/rules")) {
        throw new Error(
          `Workspace rules content leaked despite loadWorkspaceRules=false: ${JSON.stringify(rulesTrace)}`
        );
      }

      const skills = unwrap(
        await invokeSnapshot("debugSessionSkillsSnapshot", sessionId, "Skills"),
        "debugSessionSkillsSnapshot"
      ).snapshot;
      if (
        !skills.definitionPresent ||
        skills.definitionEnabled !== true ||
        skills.resolvedSkillsEnabled !== true
      ) {
        throw new Error(
          `Skills config did not resolve enabled: ${JSON.stringify(skills)}`
        );
      }
      assertIncludes(
        skills.definitionInclude,
        skillInclude[0],
        "definition skill include"
      );
      assertIncludes(
        skills.definitionExclude,
        skillExclude[0],
        "definition skill exclude"
      );
      assertIncludes(
        skills.runtimeSkillsConfigInclude,
        skillInclude[0],
        "runtime skill include"
      );
      assertIncludes(
        skills.runtimeSkillsConfigExclude,
        skillExclude[0],
        "runtime skill exclude"
      );
      assertIncludes(
        skills.effectivePerTurnDisabled,
        skillExclude[0],
        "effective per-turn skill disabled list"
      );
    } finally {
      await invokeE2E("removeAgentDef", parentAgentId);
      await invokeE2E("removeAgentDef", childAgentId);
    }
  });
});
