/* global browser, describe, before, it, process */
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitForApp } from "../../support/core/session/agentPlanFollowupScenarios.mjs";

const DEFAULT_E2E_REPO_PATH =
  process.platform === "win32"
    ? join(tmpdir(), "orgii-e2e-workspace-repo")
    : "/tmp/orgii-e2e-workspace-repo";
const E2E_REPO_PATH = process.env.E2E_REPO_PATH ?? DEFAULT_E2E_REPO_PATH;
const PENDING_SESSION_ID = "pending";
const RUN_ID = Date.now();
const MOUNT_TIMEOUT_MS = 60_000;
const RENDER_TIMEOUT_MS = 20_000;
const PERSIST_TIMEOUT_MS = 30_000;
const REPLY_TIMEOUT_MS = 180_000;
const API_ACCOUNT_NAME = process.env.E2E_OPENAI_ACCOUNT;
const API_AGENT_TYPE = process.env.E2E_API_AGENT_TYPE ?? "openai_api";
const PREFERRED_API_MODEL_ID = process.env.E2E_OPENAI_MODEL ?? "op-4.6-relay";
const SCENARIO_FILTER = (process.env.E2E_CONTROL_SCENARIOS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const ROUTINE_CONCURRENCY_SCENARIO = "routine-concurrency-policies";
const ROUTINE_CREATE_WORK_ITEM_CONTRACT_SCENARIO =
  "routine-create-work-item-contract";
const ROUTINE_CREATE_WORK_ITEM_FAILURE_SCENARIO =
  "routine-create-work-item-failure";
const WORK_ITEM_UI_LLM_SCENARIO = "work-item-ui-llm-execution";
const WORK_ITEM_RERUN_UI_LLM_SCENARIO = "work-item-rerun-ui-llm-execution";
const ROUTINE_CREATE_WORK_ITEM_UI_LLM_SCENARIO =
  "routine-create-work-item-ui-llm-execution";
const ROUTINE_FIRE_STATUS = {
  STARTED: "started",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  COALESCED: "coalesced",
  SKIPPED: "skipped",
  QUEUED: "queued",
};
const ROUTINE_CONCURRENCY_POLICY = {
  COALESCE_IF_ACTIVE: "coalesce_if_active",
  SKIP_IF_ACTIVE: "skip_if_active",
  QUEUE_IF_ACTIVE: "queue_if_active",
  ALWAYS_CREATE: "always_create",
};
const ROUTINE_OUTPUT_MODE = {
  DIRECT_SESSION: "direct_session",
  CREATE_WORK_ITEM: "create_work_item",
};

async function execJS(script) {
  return browser.executeScript(script, []);
}

async function invokeE2E(method, ...args) {
  const envelope = await browser.executeAsyncScript(
    `
    const cb = arguments[arguments.length - 1];
    const method = arguments[0];
    const rest = Array.prototype.slice.call(arguments, 1, arguments.length - 1);
    if (!window.__e2e || typeof window.__e2e[method] !== "function") {
      cb({ e2eResult: { ok: false, error: "window.__e2e." + method + " not available" } });
      return;
    }
    Promise.resolve(window.__e2e[method].apply(null, rest))
      .then((result) => cb({ e2eResult: result }))
      .catch((error) => cb({ e2eResult: { ok: false, error: String(error && error.message || error) } }));
  `,
    [method, ...args],
  );
  return (
    envelope?.e2eResult ?? {
      ok: false,
      error: "invokeE2E returned no envelope",
    }
  );
}

function unwrap(result, label) {
  if (!result || result.ok !== true) {
    throw new Error(`${label} failed: ${result?.error ?? "unknown"}`);
  }
  return result;
}

function selectRustAgentAccount(accounts) {
  const candidates = accounts.filter((row) => {
    const nameMatches =
      !API_ACCOUNT_NAME ||
      row.name === API_ACCOUNT_NAME ||
      row.id === API_ACCOUNT_NAME;
    const modelMatches = (row.enabled_models ?? []).includes(
      PREFERRED_API_MODEL_ID,
    );
    return (
      row.agent_type === API_AGENT_TYPE &&
      row.enabled &&
      row.has_api_key &&
      row.supports_rust_agents &&
      nameMatches &&
      modelMatches
    );
  });
  return candidates[0] ?? null;
}

function routineDefinition(account, workspacePath, concurrencyPolicy, suffix) {
  const now = new Date().toISOString();
  return {
    id: `e2e-routine-${suffix}-${RUN_ID}`,
    name: `E2E routine ${suffix} ${RUN_ID}`,
    description: `E2E routine concurrency coverage for ${concurrencyPolicy}`,
    enabled: true,
    trigger: { kind: "one_time", at: now },
    runTemplate: {
      prompt:
        "E2E routine concurrency probe. Reply with one short sentence and do not modify files.",
      target: { kind: "agent_definition", agentDefinitionId: "builtin:sde" },
      resources: {
        keySource: "own_key",
        accountId: account.id,
        model: PREFERRED_API_MODEL_ID,
      },
      workspace: {
        kind: "local_workspace",
        workspacePath,
        additionalDirectories: [],
      },
      mode: "investigate",
      name: `E2E routine ${suffix} ${RUN_ID}`,
    },
    outputPolicy: {
      mode: ROUTINE_OUTPUT_MODE.DIRECT_SESSION,
      concurrencyPolicy,
      catchUpPolicy: "run_once",
      maxCatchUpRuns: 1,
      idempotencyScope: "routine_fire",
      createWorkItemStatus: "planned",
    },
    createdAt: now,
    updatedAt: now,
  };
}

function routineWorkItemDefinition({
  account,
  workspacePath,
  projectSlug,
  suffix,
  title,
  body,
  concurrencyPolicy = ROUTINE_CONCURRENCY_POLICY.COALESCE_IF_ACTIVE,
}) {
  const now = new Date().toISOString();
  return {
    id: `e2e-routine-work-item-${suffix}-${RUN_ID}`,
    name: `E2E routine to Work Item ${suffix} ${RUN_ID}`,
    description: `E2E routine creates a Work Item for ${projectSlug}`,
    enabled: true,
    trigger: { kind: "one_time", at: now },
    runTemplate: {
      prompt: body,
      target: { kind: "agent_definition", agentDefinitionId: "builtin:sde" },
      resources: {
        keySource: "own_key",
        accountId: account.id,
        model: PREFERRED_API_MODEL_ID,
      },
      workspace: {
        kind: "local_workspace",
        workspacePath,
        additionalDirectories: [],
      },
      mode: "investigate",
      name: title,
    },
    outputPolicy: {
      mode: ROUTINE_OUTPUT_MODE.CREATE_WORK_ITEM,
      concurrencyPolicy,
      catchUpPolicy: "run_once",
      maxCatchUpRuns: 1,
      idempotencyScope: "routine_fire",
      createWorkItemStatus: "planned",
      createWorkItemProjectSlug: projectSlug,
      createWorkItemTitle: title,
      createWorkItemBody: body,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function shouldRunScenario(name) {
  return SCENARIO_FILTER.length === 0 || SCENARIO_FILTER.includes(name);
}

function isScenarioExplicitlyRequested(name) {
  return SCENARIO_FILTER.includes(name);
}

function assertE2ERepoFixture() {
  const requiredPaths = [
    E2E_REPO_PATH,
    join(E2E_REPO_PATH, ".git"),
    join(E2E_REPO_PATH, "README.md"),
    join(E2E_REPO_PATH, "package.json"),
  ];
  const missingPath = requiredPaths.find((path) => !existsSync(path));
  if (missingPath) {
    throw new Error(
      `E2E repo fixture is missing ${missingPath}; runner should create E2E_REPO_PATH before specs start`,
    );
  }
}

function createProjectMeta(slug, name, repoPath) {
  const now = new Date().toISOString();
  return {
    id: slug,
    name,
    org_id: "personal-org",
    status: "planned",
    priority: "none",
    health: "no_updates",
    members: [],
    labels: [],
    linked_repos: [repoPath],
    created_at: now,
    updated_at: now,
    next_work_item_id: 2,
    work_item_prefix: "E2E",
    work_item_prefix_custom: true,
  };
}

function createWorkItemFrontmatter({ shortId, title, account }) {
  const now = new Date().toISOString();
  return {
    id: shortId,
    short_id: shortId,
    title,
    status: "planned",
    priority: "none",
    labels: [],
    created_by: "e2e",
    created_at: now,
    updated_at: now,
    starred: false,
    todos: [],
    orchestrator_config: {
      review_enabled: false,
      follow_up_enabled: false,
      auto_retry_on_failure: false,
      max_retry_count: 0,
      auto_create_pr: false,
      selected_account_id: account.id,
      selected_model_id: PREFERRED_API_MODEL_ID,
      agent_definition_id: "builtin:sde",
      agent_mode: "investigate",
    },
  };
}

async function clickSelector(selector) {
  return execJS(`
    const elements = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const element = elements.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const style = window.getComputedStyle(candidate);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    });
    if (!element) return elements.length > 0 ? "hidden" : "missing";
    if (element.disabled) return "disabled";
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    return "clicked";
  `);
}

async function waitForRenderedAssistantReply(label, sessionId) {
  let state = null;
  let followAgentClicked = false;
  try {
    await browser.waitUntil(
      async () => {
        const chatState = await invokeE2E("inspectChatState");
        const assistantMessages = (chatState.chatEvents ?? [])
          .filter(
            (event) =>
              event.source === "assistant" &&
              event.displayVariant === "message" &&
              typeof event.displayText === "string" &&
              event.displayText.trim().length > 0,
          )
          .map((event) => event.displayText.trim());

        if (assistantMessages.length > 0) {
          await execJS(`
            const history = document.querySelector('[data-testid="chat-message-list"]');
            if (history) {
              const scrollCandidates = Array.from(document.querySelectorAll('*')).filter((node) => {
                const style = window.getComputedStyle(node);
                const canScrollY = style.overflowY === 'auto' || style.overflowY === 'scroll';
                return canScrollY && node.scrollHeight > node.clientHeight + 8;
              });
              for (const node of scrollCandidates) {
                if (node.contains(history) || history.contains(node)) {
                  node.scrollTop = node.scrollHeight;
                }
              }
              history.scrollTop = history.scrollHeight;
            }
          `);
        }

        const domState = await execJS(`
          const history = document.querySelector('[data-testid="chat-message-list"]');
          const assistantMessages = ${JSON.stringify(assistantMessages)};
          const assistantRows = Array.from(document.querySelectorAll('[data-testid="chat-message-assistant"]'));
          const assistantTexts = assistantRows.map((row) => row.textContent || "");
          const bodyText = document.body.innerText || "";
          const visibleAssistantMessages = assistantMessages.filter((message) => {
            const snippet = message.slice(0, Math.min(80, message.length));
            return snippet.length > 0 && bodyText.includes(snippet);
          });
          const activityLike = Array.from(
            document.querySelectorAll('[data-testid^="chat-message"], .chat-text, .activity-chat-item, .resultBgc, [data-e2e-chat-flat-index]')
          ).slice(0, 50).map((node) => ({
            tag: node.tagName,
            testId: node.getAttribute('data-testid'),
            className: typeof node.className === 'string' ? node.className : '',
            text: (node.textContent || '').trim().slice(0, 300),
          }));
          return {
            assistantTexts: assistantTexts.filter((text) => text.trim().length > 0),
            visibleAssistantMessages,
            hasFollowAgentButton: Array.from(document.querySelectorAll('button')).some(
              (button) => (button.textContent || '').trim() === 'Follow Agent'
            ),
            historyAttrs: history ? {
              chatHistoryCount: history.getAttribute('data-chat-history-count'),
              optimizedCount: history.getAttribute('data-optimized-count'),
              flatCount: history.getAttribute('data-flat-count'),
              groupCounts: history.getAttribute('data-group-counts'),
            } : null,
            activityLike,
            historyHtml: history?.innerHTML?.slice(0, 4000) || "",
            historyText: history?.textContent || "",
            bodyText: bodyText.slice(0, 4000),
          };
        `);
        const aggregateState = sessionId
          ? await invokeE2E("getSessionAggregateRow", sessionId)
          : null;
        state = { domState, chatState, aggregateState };

        if (
          !followAgentClicked &&
          assistantMessages.length > 0 &&
          domState.hasFollowAgentButton
        ) {
          const clicked = await execJS(`
            const button = Array.from(document.querySelectorAll('button')).find(
              (candidate) => (candidate.textContent || '').trim() === 'Follow Agent'
            );
            if (!button) return false;
            button.click();
            return true;
          `);
          followAgentClicked = Boolean(clicked);
          if (followAgentClicked) return false;
        }

        if (domState.assistantTexts.some((text) => text.trim().length > 0)) {
          return true;
        }
        if (domState.visibleAssistantMessages.length > 0) {
          return true;
        }

        return false;
      },
      {
        timeout: REPLY_TIMEOUT_MS,
        interval: 1000,
        timeoutMsg: `No rendered assistant reply appeared for ${label}`,
      },
    );
  } catch (error) {
    throw new Error(
      `No rendered assistant reply appeared for ${label}: latest=${JSON.stringify(state)} original=${String(error?.message ?? error)}`,
    );
  }
}

async function waitForSessionAggregateRow(sessionId, predicate, label) {
  let latestSession = null;
  let latestResult = null;
  try {
    await browser.waitUntil(
      async () => {
        try {
          const rawResult = await invokeE2E("getSessionAggregateRow", sessionId);
          latestResult = rawResult;
          const result = unwrap(rawResult, `getSessionAggregateRow(${label})`);
          latestSession = result.session;
          return Boolean(latestSession && predicate(latestSession));
        } catch (error) {
          latestResult = {
            ok: false,
            thrown: String(error?.message ?? error),
          };
          return false;
        }
      },
      {
        timeout: PERSIST_TIMEOUT_MS,
        interval: 500,
        timeoutMsg: `Session aggregate row did not match ${label}`,
      },
    );
  } catch (error) {
    throw new Error(
      `Session aggregate row did not match ${label}: sessionId=${sessionId} latestSession=${JSON.stringify(latestSession)} latestResult=${JSON.stringify(latestResult)} original=${String(error?.message ?? error)}`,
    );
  }
  return latestSession;
}

async function waitForWorkItemLock(projectSlug, shortId, label) {
  let lockedItem = null;
  let lastReadResult = null;
  try {
    await browser.waitUntil(
      async () => {
        try {
          const result = await invokeE2E("readWorkItem", projectSlug, shortId);
          lastReadResult = result;
          if (!result?.ok || !result.item) {
            return false;
          }
          lockedItem = result.item;
          const activeSessionId = lockedItem.frontmatter?.execution_lock?.activeSessionId;
          return typeof activeSessionId === "string" && activeSessionId !== PENDING_SESSION_ID;
        } catch (error) {
          lastReadResult = {
            ok: false,
            error: String(error?.message ?? error),
          };
          return false;
        }
      },
      {
        timeout: PERSIST_TIMEOUT_MS,
        interval: 500,
      },
    );
  } catch (error) {
    throw new Error(
      `Work Item execution lock was not persisted for ${label}: item=${JSON.stringify(lockedItem)} readResult=${JSON.stringify(lastReadResult)} waitError=${String(error?.message ?? error)}`,
    );
  }
  return lockedItem;
}

async function waitForWorkItemLockCleared(projectSlug, shortId, sessionId, label) {
  let item = null;
  await browser.waitUntil(
    async () => {
      item = unwrap(
        await invokeE2E("readWorkItem", projectSlug, shortId),
        `readWorkItem(${label})`,
      ).item;
      const activeSessionId = item.frontmatter?.execution_lock?.activeSessionId;
      return !activeSessionId || activeSessionId !== sessionId;
    },
    {
      timeout: PERSIST_TIMEOUT_MS,
      interval: 500,
      timeoutMsg: `Work Item execution lock did not clear for ${label}: ${JSON.stringify(item)}`,
    },
  );
  return item;
}

async function waitForVisibleSelector(selector, label, timeout = RENDER_TIMEOUT_MS) {
  await browser.waitUntil(
    async () =>
      execJS(`
        return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some((candidate) => {
          const rect = candidate.getBoundingClientRect();
          const style = window.getComputedStyle(candidate);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        });
      `),
    {
      timeout,
      timeoutMsg: `${label} did not render for selector ${selector}`,
    },
  );
}

async function waitForWorkItemByTitle(projectSlug, title, label) {
  let matchedItem = null;
  await browser.waitUntil(
    async () => {
      const result = unwrap(
        await invokeE2E("readWorkItemsEnriched", projectSlug),
        `readWorkItemsEnriched(${label})`,
      );
      matchedItem = result.items.find((item) => item.title === title) ?? null;
      return Boolean(matchedItem?.shortId || matchedItem?.short_id);
    },
    {
      timeout: PERSIST_TIMEOUT_MS,
      interval: 500,
      timeoutMsg: `Routine-created Work Item was not listed for ${label}: ${JSON.stringify(matchedItem)}`,
    },
  );
  return matchedItem;
}

async function listWorkItemsByTitle(projectSlug, title, label) {
  return unwrap(
    await invokeE2E("readWorkItemsEnriched", projectSlug),
    `readWorkItemsEnriched(${label})`,
  ).items.filter((item) => item.title === title);
}

async function latestRoutineFire(routineId, label) {
  const fires = unwrap(
    await invokeE2E("listRoutineFires", routineId),
    `listRoutineFires(${label})`,
  ).fires;
  return fires[0] ?? null;
}

async function assertNoSessionForRoutineFire(fireResult, label) {
  if (fireResult.sessionId || fireResult.agentOrgRunId) {
    throw new Error(
      `${label} must not launch a session immediately: ${JSON.stringify(fireResult)}`,
    );
  }
}

async function startWorkItemRunFromUi(projectSlug, projectName, shortId, label) {
  await openSeededWorkItemExecutionTab(projectSlug, projectName, shortId);
  await waitForStartButtonState("enabled", `${label} initial execution tab`);
  const startSelector = '[data-testid="work-item-start-agent-button"]';
  const workflowSelector = '[data-testid="work-item-agent-workflow"]';
  const startClick = await execJS(`
    const workflow = document.querySelector(${JSON.stringify(workflowSelector)});
    const elements = workflow
      ? Array.from(workflow.querySelectorAll(${JSON.stringify(startSelector)}))
      : [];
    const buttonStates = elements.map((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const style = window.getComputedStyle(candidate);
      return {
        text: (candidate.textContent || '').trim(),
        disabled: Boolean(candidate.disabled),
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
      };
    });
    const element = elements.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const style = window.getComputedStyle(candidate);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    });
    if (!element) return { result: elements.length > 0 ? "hidden" : "missing", buttonStates };
    if (element.disabled) return { result: "disabled", buttonStates };
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    return { result: "clicked", buttonStates };
  `);
  if (startClick.result !== "clicked") {
    throw new Error(`${label} Start Agent click failed: ${JSON.stringify(startClick)}`);
  }
  try {
    const lockedItem = await waitForWorkItemLock(
      projectSlug,
      shortId,
      `${label} Start Agent click`,
    );
    return lockedItem.frontmatter.execution_lock.activeSessionId;
  } catch (lockError) {
    let activeSessionState = null;
    let aggregateState = null;
    try {
      await browser.waitUntil(
        async () => {
          activeSessionState = unwrap(
            await invokeE2E("getActiveSessionId"),
            `getActiveSessionId(${label})`,
          );
          const sessionId = activeSessionState.sessionId;
          if (!sessionId) return false;
          aggregateState = await invokeE2E("getSessionAggregateRow", sessionId);
          if (!aggregateState?.ok || !aggregateState.session) return false;
          return (
            aggregateState.session.workItemId === shortId &&
            aggregateState.session.projectSlug === projectSlug
          );
        },
        {
          timeout: PERSIST_TIMEOUT_MS,
          interval: 500,
          timeoutMsg: `Active Work Item session did not appear for ${label}`,
        },
      );
      return activeSessionState.sessionId;
    } catch (fallbackError) {
      throw new Error(
        `${String(lockError?.message ?? lockError)}; activeSessionState=${JSON.stringify(activeSessionState)} aggregateState=${JSON.stringify(aggregateState)} fallback=${String(fallbackError?.message ?? fallbackError)}`,
      );
    }
  }
}

async function openSeededWorkItemExecutionTab(projectSlug, projectName, shortId) {
  const openState = unwrap(
    await invokeE2E("openProjectWorkItemsTab", projectSlug, projectName, projectSlug),
    "openProjectWorkItemsTab(work item execution tab)",
  );

  const rowSelector = `[data-testid="work-item-row-${shortId}"]`;
  const targetProjectTabId = openState.activeTabId;
  const projectTabSelector = `[data-tab-id="${targetProjectTabId}"]`;
  let projectOpenState = null;
  await browser.waitUntil(
    async () => {
      const tabClick = targetProjectTabId ? await clickSelector(projectTabSelector) : "missing";
      projectOpenState = await execJS(`
        const router = document.querySelector('[data-testid="project-manager-content-router"]');
        const activeTabId = router?.getAttribute('data-active-tab-id') || null;
        const activeTabType = router?.getAttribute('data-active-tab-type') || null;
        const bodyText = document.body.innerText || '';
        const isVisible = (candidate) => {
          if (!candidate) return false;
          const rect = candidate.getBoundingClientRect();
          const style = window.getComputedStyle(candidate);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const hasVisibleWorkItemRow = Array.from(document.querySelectorAll(${JSON.stringify(rowSelector)})).some(isVisible);
        const hasVisibleExecutionTab = isVisible(document.querySelector('[data-testid="work-item-tab-execution"]'));
        return {
          activeTabId,
          activeTabType,
          hasVisibleWorkItemRow,
          hasVisibleExecutionTab,
          openState: ${JSON.stringify(openState)},
          tabClick: ${JSON.stringify(tabClick)},
          bodyText: bodyText.slice(0, 1000),
        };
      `);
      return projectOpenState.hasVisibleWorkItemRow || projectOpenState.hasVisibleExecutionTab;
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      interval: 500,
      timeoutMsg: `Project Work Item surface did not become visible for ${projectSlug}`,
    },
  ).catch((error) => {
    throw new Error(
      `Project Work Item surface did not become visible for ${projectSlug}; latest=${JSON.stringify(projectOpenState)} original=${String(error?.message ?? error)}`,
    );
  });
  const executionTabSelector = '[data-testid="work-item-tab-execution"]';
  const initialDetailState = await execJS(`
    const executionTab = document.querySelector(${JSON.stringify(executionTabSelector)});
    if (!executionTab) return "missing";
    const rect = executionTab.getBoundingClientRect();
    const style = window.getComputedStyle(executionTab);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      ? "visible"
      : "hidden";
  `);

  if (initialDetailState !== "visible") {
    await waitForVisibleSelector(rowSelector, "seeded Work Item row", MOUNT_TIMEOUT_MS);
    let rowOpenState = null;
    await browser.waitUntil(
      async () => {
        const rowClick = await clickSelector(rowSelector);
        rowOpenState = await execJS(`
          const bodyText = document.body.innerText || '';
          const router = document.querySelector('[data-testid="project-manager-content-router"]');
          const activeTabId = router?.getAttribute('data-active-tab-id') || null;
          const activeTabType = router?.getAttribute('data-active-tab-type') || null;
          const rowElements = Array.from(document.querySelectorAll(${JSON.stringify(rowSelector)}));
          const executionTab = document.querySelector(${JSON.stringify(executionTabSelector)});
          const executionRect = executionTab?.getBoundingClientRect();
          return {
            clicked: ${JSON.stringify(rowClick)},
            hasShortId: bodyText.includes(${JSON.stringify(shortId)}),
            hasExecutionTab: Boolean(executionTab),
            executionTabWidth: executionRect?.width ?? 0,
            executionTabHeight: executionRect?.height ?? 0,
            activeTabId,
            activeTabType,
            openState: ${JSON.stringify(openState)},
            rowCount: rowElements.length,
            rowDisplays: rowElements.map((row) => {
              const rect = row.getBoundingClientRect();
              const style = window.getComputedStyle(row);
              return {
                display: style.display,
                visibility: style.visibility,
                width: rect.width,
                height: rect.height,
                text: (row.textContent || '').slice(0, 160),
              };
            }),
            bodyText: bodyText.slice(0, 1000),
          };
        `);
        return (
          rowOpenState.hasExecutionTab ||
          (rowClick === "clicked" && rowOpenState.hasShortId)
        );
      },
      {
        timeout: MOUNT_TIMEOUT_MS,
        interval: 500,
        timeoutMsg: `Work Item row did not open detail for ${shortId}`,
      },
    ).catch((error) => {
      throw new Error(
        `Work Item row did not open detail for ${shortId}; latest=${JSON.stringify(rowOpenState)} original=${String(error?.message ?? error)}`,
      );
    });
  }

  await waitForVisibleSelector(
    executionTabSelector,
    "Work Item detail execution tab",
    MOUNT_TIMEOUT_MS,
  );
  const tabClick = await clickSelector(executionTabSelector);
  if (tabClick !== "clicked") {
    throw new Error(`Execution tab click failed: ${tabClick}`);
  }
}

async function waitForStartButtonState(expectedState, label) {
  const startSelector = '[data-testid="work-item-start-agent-button"]';
  let state = null;
  try {
    await browser.waitUntil(
      async () => {
        state = await execJS(`
          const button = document.querySelector(${JSON.stringify(startSelector)});
          const executionTab = document.querySelector('[data-testid="work-item-detail-tab-execution"]');
          const workflow = document.querySelector('[data-testid="work-item-agent-workflow"]');
          const bodyText = document.body.innerText || '';
          return {
            buttonState: button ? (button.disabled ? "disabled" : "enabled") : "missing",
            hasExecutionTab: Boolean(executionTab),
            hasWorkflow: Boolean(workflow),
            workflowText: (workflow?.textContent || '').slice(0, 1000),
            bodyText: bodyText.slice(0, 2000),
          };
        `);
        return state.buttonState === expectedState;
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 500,
        timeoutMsg: `Start Agent button did not become ${expectedState} for ${label}`,
      },
    );
  } catch (error) {
    throw new Error(
      `Start Agent button did not become ${expectedState} for ${label}; latest=${JSON.stringify(state)} original=${String(error?.message ?? error)}`,
    );
  }
}

async function waitForStartAgentBlocked(label) {
  const startSelector = '[data-testid="work-item-start-agent-button"]';
  const activeSelector = '[data-testid="work-item-agent-active-phase"]';
  let state = null;
  try {
    await browser.waitUntil(
      async () => {
        state = await execJS(`
          const button = document.querySelector(${JSON.stringify(startSelector)});
          if (button) return button.disabled ? "disabled" : "enabled";
          const activePhase = document.querySelector(${JSON.stringify(activeSelector)});
          return activePhase ? "active-phase" : "missing";
        `);
        return state === "disabled" || state === "active-phase";
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 500,
        timeoutMsg: `Start Agent entry point remained available for ${label}`,
      },
    );
  } catch (error) {
    throw new Error(
      `Start Agent entry point remained available for ${label}; latest=${state} original=${String(error?.message ?? error)}`,
    );
  }
}

async function waitForStartAgentBlockedOrCompleted(
  projectSlug,
  shortId,
  sessionId,
  label,
) {
  const startSelector = '[data-testid="work-item-start-agent-button"]';
  const activeSelector = '[data-testid="work-item-agent-active-phase"]';
  let latest = null;
  try {
    await browser.waitUntil(
      async () => {
        const domState = await execJS(`
          const button = document.querySelector(${JSON.stringify(startSelector)});
          const activePhase = document.querySelector(${JSON.stringify(activeSelector)});
          const completedPhase = document.querySelector('[data-testid="work-item-agent-completed-phase"]');
          const executionTab = document.querySelector('[data-testid="work-item-tab-execution"]');
          const detailText = document.body.innerText || '';
          const state = button
            ? (button.disabled ? "disabled" : "enabled")
            : activePhase
              ? "active-phase"
              : completedPhase
                ? "completed-phase"
                : "missing";
          return {
            state,
            hasExecutionTab: Boolean(executionTab),
            hasShortId: detailText.includes(${JSON.stringify(shortId)}),
            bodyText: detailText.slice(0, 1200),
          };
        `);
        const itemResult = await invokeE2E("readWorkItem", projectSlug, shortId);
        const sessionResult = await invokeE2E("getSessionAggregateRow", sessionId);
        latest = { domState, itemResult, sessionResult };
        if (!itemResult?.ok || !sessionResult?.ok) return false;

        const activeSessionId =
          itemResult.item?.frontmatter?.execution_lock?.activeSessionId;
        if (activeSessionId === sessionId) {
          return domState.state === "disabled" || domState.state === "active-phase";
        }

        const status = sessionResult.session?.status;
        return (
          status &&
          status !== "running" &&
          (domState.state === "enabled" ||
            domState.state === "completed-phase" ||
            domState.state === "missing")
        );
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 500,
        timeoutMsg: `Start Agent did not settle for ${label}`,
      },
    );
  } catch (error) {
    throw new Error(
      `Start Agent did not settle for ${label}; latest=${JSON.stringify(latest)} original=${String(error?.message ?? error)}`,
    );
  }
  return latest;
}

describe("Work Item durable object runtime invariants", function () {
  this.timeout(420_000);

  before(async () => {
    if (
      !shouldRunScenario(ROUTINE_CONCURRENCY_SCENARIO) &&
      !shouldRunScenario(ROUTINE_CREATE_WORK_ITEM_CONTRACT_SCENARIO) &&
      !shouldRunScenario(ROUTINE_CREATE_WORK_ITEM_FAILURE_SCENARIO) &&
      !shouldRunScenario(WORK_ITEM_UI_LLM_SCENARIO) &&
      !shouldRunScenario(WORK_ITEM_RERUN_UI_LLM_SCENARIO) &&
      !shouldRunScenario(ROUTINE_CREATE_WORK_ITEM_UI_LLM_SCENARIO)
    ) {
      return;
    }
    assertE2ERepoFixture();
    await browser.setTimeout({ script: 420_000 });
    await waitForApp();
    await browser.waitUntil(
      async () =>
        execJS(
          `return !!(window.__e2e && window.__e2e.listAccounts && window.__e2e.ensureRepoSelected && window.__e2e.upsertRoutine && window.__e2e.fireRoutine && window.__e2e.listRoutineFires && window.__e2e.writeProject && window.__e2e.writeWorkItem && window.__e2e.readWorkItem && window.__e2e.readWorkItemsEnriched && window.__e2e.openProjectWorkItemsTab && window.__e2e.openSession && window.__e2e.getSessionAggregateRow && window.__e2e.resetToNewSession && window.__e2e.agentOrgSimulateAppRestart);`,
        ),
      {
        timeout: MOUNT_TIMEOUT_MS,
        timeoutMsg:
          "required Work Item durable object E2E helpers never mounted",
      },
    );
  });

  it("applies Routine concurrency policy while a direct session fire is active", async function () {
    if (!shouldRunScenario(ROUTINE_CONCURRENCY_SCENARIO)) {
      this.skip();
      return;
    }

    const accounts = unwrap(
      await invokeE2E("listAccounts"),
      "listAccounts",
    ).accounts;
    const account = selectRustAgentAccount(accounts);
    if (!account) {
      if (isScenarioExplicitlyRequested(ROUTINE_CONCURRENCY_SCENARIO)) {
        throw new Error(
          `No enabled Rust-agent account matched agentType=${API_AGENT_TYPE} model=${PREFERRED_API_MODEL_ID} account=${API_ACCOUNT_NAME ?? "<any>"}`,
        );
      }
      this.skip();
      return;
    }

    const repo = unwrap(
      await invokeE2E("ensureRepoSelected", { repoPath: E2E_REPO_PATH }),
      "ensureRepoSelected",
    );
    const cases = [
      {
        suffix: "coalesce",
        policy: ROUTINE_CONCURRENCY_POLICY.COALESCE_IF_ACTIVE,
        expectedStatus: ROUTINE_FIRE_STATUS.COALESCED,
        expectsPointer: true,
      },
      {
        suffix: "skip",
        policy: ROUTINE_CONCURRENCY_POLICY.SKIP_IF_ACTIVE,
        expectedStatus: ROUTINE_FIRE_STATUS.SKIPPED,
        expectsPointer: false,
      },
      {
        suffix: "queue",
        policy: ROUTINE_CONCURRENCY_POLICY.QUEUE_IF_ACTIVE,
        expectedStatus: ROUTINE_FIRE_STATUS.QUEUED,
        expectsPointer: false,
      },
    ];

    for (const testCase of cases) {
      const routine = routineDefinition(
        account,
        repo.path,
        testCase.policy,
        testCase.suffix,
      );
      const saved = unwrap(
        await invokeE2E("upsertRoutine", routine),
        `upsertRoutine(${testCase.suffix})`,
      ).routine;

      const first = unwrap(
        await invokeE2E("fireRoutine", saved.id),
        `first fireRoutine(${testCase.suffix})`,
      ).result;
      if (!first.sessionId || typeof first.sessionId !== "string") {
        throw new Error(
          `First routine fire did not create a production session for ${testCase.suffix}: ${JSON.stringify(first)}`,
        );
      }
      if (first.fire?.status !== ROUTINE_FIRE_STATUS.STARTED) {
        throw new Error(
          `First routine fire should be started after session launch for ${testCase.suffix}: ${JSON.stringify(first)}`,
        );
      }

      const second = unwrap(
        await invokeE2E("fireRoutine", saved.id),
        `second fireRoutine(${testCase.suffix})`,
      ).result;
      if (second.sessionId) {
        throw new Error(
          `Non-pending routine fire unexpectedly created a session for ${testCase.suffix}: ${JSON.stringify(second)}`,
        );
      }
      if (second.fire?.status !== testCase.expectedStatus) {
        throw new Error(
          `Second routine fire had wrong status for ${testCase.suffix}; expected=${testCase.expectedStatus} result=${JSON.stringify(second)}`,
        );
      }
      if (testCase.expectsPointer) {
        if (second.fire?.coalescedIntoFireId !== first.fire?.id) {
          throw new Error(
            `Coalesced fire did not point to first fire; first=${JSON.stringify(first)} second=${JSON.stringify(second)}`,
          );
        }
      } else if (second.fire?.coalescedIntoFireId) {
        throw new Error(
          `Non-coalesced fire unexpectedly stored coalescedIntoFireId for ${testCase.suffix}: ${JSON.stringify(second)}`,
        );
      }
    }
  });

  it("records Routine create_work_item fires as durable Work Item creation events", async function () {
    if (!shouldRunScenario(ROUTINE_CREATE_WORK_ITEM_CONTRACT_SCENARIO)) {
      this.skip();
      return;
    }

    const accounts = unwrap(
      await invokeE2E("listAccounts"),
      "listAccounts(routine work item contract)",
    ).accounts;
    const account = selectRustAgentAccount(accounts);
    if (!account) {
      if (isScenarioExplicitlyRequested(ROUTINE_CREATE_WORK_ITEM_CONTRACT_SCENARIO)) {
        throw new Error(
          `No enabled Rust-agent account matched agentType=${API_AGENT_TYPE} model=${PREFERRED_API_MODEL_ID} account=${API_ACCOUNT_NAME ?? "<any>"}`,
        );
      }
      this.skip();
      return;
    }

    const repo = unwrap(
      await invokeE2E("ensureRepoSelected", { repoPath: E2E_REPO_PATH }),
      "ensureRepoSelected(routine work item contract)",
    );
    const projectSlug = `e2e-routine-contract-${RUN_ID}`;
    const projectName = `E2E Routine Contract ${RUN_ID}`;
    const routineWorkItemTitle = `E2E routine contract Work Item ${RUN_ID}`;
    const routineWorkItemBody =
      "Routine contract Work Item body. This scenario should not start an LLM session.";

    await invokeE2E("deleteProject", projectSlug);
    unwrap(
      await invokeE2E(
        "writeProject",
        projectSlug,
        createProjectMeta(projectSlug, projectName, repo.path),
        "E2E project for Routine create_work_item contract coverage.",
        true,
      ),
      "writeProject(routine work item contract)",
    );

    const routine = routineWorkItemDefinition({
      account,
      workspacePath: repo.path,
      projectSlug,
      suffix: "contract",
      title: routineWorkItemTitle,
      body: routineWorkItemBody,
      concurrencyPolicy: ROUTINE_CONCURRENCY_POLICY.ALWAYS_CREATE,
    });
    const savedRoutine = unwrap(
      await invokeE2E("upsertRoutine", routine),
      "upsertRoutine(routine create_work_item contract)",
    ).routine;

    const first = unwrap(
      await invokeE2E("fireRoutine", savedRoutine.id),
      "first fireRoutine(create Work Item contract)",
    ).result;
    await assertNoSessionForRoutineFire(first, "first create_work_item fire");
    if (first.fire?.status !== ROUTINE_FIRE_STATUS.SUCCEEDED || !first.fire?.workItemId) {
      throw new Error(
        `First create_work_item fire did not persist succeeded Work Item fire: ${JSON.stringify(first)}`,
      );
    }

    const second = unwrap(
      await invokeE2E("fireRoutine", savedRoutine.id),
      "second fireRoutine(create Work Item contract)",
    ).result;
    await assertNoSessionForRoutineFire(second, "second create_work_item fire");
    if (second.fire?.status !== ROUTINE_FIRE_STATUS.SUCCEEDED || !second.fire?.workItemId) {
      throw new Error(
        `Second create_work_item fire did not persist succeeded Work Item fire: ${JSON.stringify(second)}`,
      );
    }
    if (second.fire.workItemId === first.fire.workItemId) {
      throw new Error(
        `always_create create_work_item reused a Work Item id: first=${JSON.stringify(first.fire)} second=${JSON.stringify(second.fire)}`,
      );
    }

    const matchingItems = await listWorkItemsByTitle(
      projectSlug,
      routineWorkItemTitle,
      "routine create_work_item contract duplicate list",
    );
    if (matchingItems.length !== 2) {
      throw new Error(
        `Expected two distinct Work Items for two always_create fires, got ${matchingItems.length}: ${JSON.stringify(matchingItems)}`,
      );
    }

    for (const fireResult of [first, second]) {
      const shortId = fireResult.fire.workItemId;
      const item = unwrap(
        await invokeE2E("readWorkItem", projectSlug, shortId),
        `readWorkItem(${shortId})`,
      ).item;
      const frontmatter = item.frontmatter ?? {};
      if (frontmatter.routine_source?.routineFireId !== fireResult.fire.id) {
        throw new Error(
          `Created Work Item did not point back to its own fire: fire=${JSON.stringify(fireResult.fire)} routine_source=${JSON.stringify(frontmatter.routine_source)}`,
        );
      }
      if (frontmatter.execution_lock?.activeSessionId) {
        throw new Error(
          `create_work_item contract unexpectedly persisted an execution lock before user start: ${JSON.stringify(frontmatter.execution_lock)}`,
        );
      }
      if (
        frontmatter.orchestrator_config?.selected_account_id !== account.id ||
        frontmatter.orchestrator_config?.selected_model_id !== PREFERRED_API_MODEL_ID ||
        frontmatter.orchestrator_config?.agent_definition_id !== "builtin:sde" ||
        frontmatter.orchestrator_config?.agent_mode !== "investigate"
      ) {
        throw new Error(
          `Created Work Item did not inherit executable config: ${JSON.stringify(frontmatter.orchestrator_config)}`,
        );
      }
    }
  });

  it("creates a standalone Work Item when Routine create_work_item has no Project", async function () {
    if (!shouldRunScenario(ROUTINE_CREATE_WORK_ITEM_FAILURE_SCENARIO)) {
      this.skip();
      return;
    }

    const accounts = unwrap(
      await invokeE2E("listAccounts"),
      "listAccounts(routine standalone work item)",
    ).accounts;
    const account = selectRustAgentAccount(accounts);
    if (!account) {
      if (isScenarioExplicitlyRequested(ROUTINE_CREATE_WORK_ITEM_FAILURE_SCENARIO)) {
        throw new Error(
          `No enabled Rust-agent account matched agentType=${API_AGENT_TYPE} model=${PREFERRED_API_MODEL_ID} account=${API_ACCOUNT_NAME ?? "<any>"}`,
        );
      }
      this.skip();
      return;
    }

    const repo = unwrap(
      await invokeE2E("ensureRepoSelected", { repoPath: E2E_REPO_PATH }),
      "ensureRepoSelected(routine standalone work item)",
    );
    const title = `E2E routine standalone Work Item ${RUN_ID}`;
    const body = "This fire should create a Work Item without project association.";
    const routine = routineWorkItemDefinition({
      account,
      workspacePath: repo.path,
      projectSlug: undefined,
      suffix: "standalone",
      title,
      body,
    });
    delete routine.outputPolicy.createWorkItemProjectSlug;
    const savedRoutine = unwrap(
      await invokeE2E("upsertRoutine", routine),
      "upsertRoutine(routine standalone create_work_item)",
    ).routine;

    const result = unwrap(
      await invokeE2E("fireRoutine", savedRoutine.id),
      "fireRoutine(routine standalone create_work_item)",
    ).result;
    const latestFire = await latestRoutineFire(savedRoutine.id, "standalone create_work_item fire");
    if (latestFire?.status !== ROUTINE_FIRE_STATUS.COMPLETED) {
      throw new Error(
        `Standalone create_work_item fire was not durably completed: ${JSON.stringify(latestFire)}`,
      );
    }
    const shortId = result.fire?.workItemId ?? latestFire.workItemId;
    if (!shortId) {
      throw new Error(
        `Standalone create_work_item fire did not link a Work Item: result=${JSON.stringify(result)} latest=${JSON.stringify(latestFire)}`,
      );
    }

    const item = unwrap(
      await invokeE2E("readStandaloneWorkItem", shortId),
      `readStandaloneWorkItem(${shortId})`,
    ).item;
    const frontmatter = item.frontmatter ?? {};
    if (frontmatter.project !== undefined && frontmatter.project !== null) {
      throw new Error(
        `Routine-created standalone Work Item unexpectedly has a project: ${JSON.stringify(frontmatter)}`,
      );
    }
    if (frontmatter.title !== title || item.body !== body) {
      throw new Error(
        `Routine-created standalone Work Item did not preserve content: ${JSON.stringify(item)}`,
      );
    }
    if (frontmatter.routine_source?.routineFireId !== latestFire.id) {
      throw new Error(
        `Routine-created standalone Work Item did not point back to its fire: fire=${JSON.stringify(latestFire)} routine_source=${JSON.stringify(frontmatter.routine_source)}`,
      );
    }
  });

  it("creates a Work Item from a Routine fire and then executes it from rendered UI", async function () {
    if (!shouldRunScenario(ROUTINE_CREATE_WORK_ITEM_UI_LLM_SCENARIO)) {
      this.skip();
      return;
    }

    const accounts = unwrap(
      await invokeE2E("listAccounts"),
      "listAccounts(routine work item ui llm)",
    ).accounts;
    const account = selectRustAgentAccount(accounts);
    if (!account) {
      if (isScenarioExplicitlyRequested(ROUTINE_CREATE_WORK_ITEM_UI_LLM_SCENARIO)) {
        throw new Error(
          `No enabled Rust-agent account matched agentType=${API_AGENT_TYPE} model=${PREFERRED_API_MODEL_ID} account=${API_ACCOUNT_NAME ?? "<any>"}`,
        );
      }
      this.skip();
      return;
    }

    const repo = unwrap(
      await invokeE2E("ensureRepoSelected", { repoPath: E2E_REPO_PATH }),
      "ensureRepoSelected(routine work item ui llm)",
    );
    const projectSlug = `e2e-routine-work-item-${RUN_ID}`;
    const projectName = `E2E Routine Work Item ${RUN_ID}`;
    const routineWorkItemTitle = `E2E routine-generated Work Item ${RUN_ID}`;
    const routineWorkItemBody =
      "Routine-created Work Item rendered UI LLM execution probe. Reply briefly and do not modify files.";

    await invokeE2E("deleteProject", projectSlug);
    unwrap(
      await invokeE2E(
        "writeProject",
        projectSlug,
        createProjectMeta(projectSlug, projectName, repo.path),
        "E2E project for Routine-created Work Item execution.",
        true,
      ),
      "writeProject(routine work item ui llm)",
    );

    const routine = routineWorkItemDefinition({
      account,
      workspacePath: repo.path,
      projectSlug,
      suffix: "ui-llm",
      title: routineWorkItemTitle,
      body: routineWorkItemBody,
    });
    const savedRoutine = unwrap(
      await invokeE2E("upsertRoutine", routine),
      "upsertRoutine(routine creates Work Item)",
    ).routine;
    const fireResult = unwrap(
      await invokeE2E("fireRoutine", savedRoutine.id),
      "fireRoutine(create Work Item)",
    ).result;
    if (fireResult.sessionId || fireResult.agentOrgRunId) {
      throw new Error(
        `Routine create_work_item fire must not launch a session immediately: ${JSON.stringify(fireResult)}`,
      );
    }
    if (fireResult.fire?.status !== "succeeded" || !fireResult.fire?.workItemId) {
      throw new Error(
        `Routine create_work_item fire did not persist a succeeded Work Item fire: ${JSON.stringify(fireResult)}`,
      );
    }

    const createdShortId = fireResult.fire.workItemId;
    const listedItem = await waitForWorkItemByTitle(
      projectSlug,
      routineWorkItemTitle,
      "Routine fire created Work Item list row",
    );
    const listedShortId = listedItem.shortId ?? listedItem.short_id;
    if (listedShortId !== createdShortId) {
      throw new Error(
        `Routine fire workItemId did not match listed Work Item: fire=${createdShortId} listed=${JSON.stringify(listedItem)}`,
      );
    }

    const createdWorkItem = unwrap(
      await invokeE2E("readWorkItem", projectSlug, createdShortId),
      "readWorkItem(routine-created)",
    ).item;
    const frontmatter = createdWorkItem.frontmatter ?? {};
    if (frontmatter.routine_source?.routineFireId !== fireResult.fire.id) {
      throw new Error(
        `Routine-created Work Item did not persist routine_source linkage: ${JSON.stringify(frontmatter.routine_source)}`,
      );
    }
    if (
      frontmatter.orchestrator_config?.selected_account_id !== account.id ||
      frontmatter.orchestrator_config?.selected_model_id !== PREFERRED_API_MODEL_ID ||
      frontmatter.orchestrator_config?.agent_definition_id !== "builtin:sde" ||
      frontmatter.orchestrator_config?.agent_mode !== "investigate"
    ) {
      throw new Error(
        `Routine-created Work Item did not inherit executable orchestrator_config: ${JSON.stringify(frontmatter.orchestrator_config)}`,
      );
    }

    await openSeededWorkItemExecutionTab(projectSlug, projectName, createdShortId);
    await waitForStartButtonState("enabled", "routine-created Work Item execution tab");

    const startSelector = '[data-testid="work-item-start-agent-button"]';
    const startClick = await clickSelector(startSelector);
    if (startClick !== "clicked") {
      throw new Error(`Routine-created Work Item Start Agent click failed: ${startClick}`);
    }

    const lockedItem = await waitForWorkItemLock(
      projectSlug,
      createdShortId,
      "routine-created Work Item Start Agent click",
    );
    const activeSessionId = lockedItem.frontmatter.execution_lock.activeSessionId;
    await waitForSessionAggregateRow(
      activeSessionId,
      (session) =>
        session.sessionId === activeSessionId &&
        session.category === "rust_agent" &&
        session.model === PREFERRED_API_MODEL_ID &&
        session.accountId === account.id &&
        session.workItemId === createdShortId &&
        session.projectSlug === projectSlug &&
        session.workspacePath === repo.path,
      "Routine-created Work Item launched session aggregate linkage",
    );

    const duplicateClick = await clickSelector(startSelector);
    if (duplicateClick !== "disabled" && duplicateClick !== "missing") {
      throw new Error(
        `Routine-created duplicate Start Agent click should be blocked by active lock, got: ${duplicateClick}`,
      );
    }

    unwrap(
      await invokeE2E("resetToNewSession"),
      "resetToNewSession(routine-created active lock)",
    );
    await openSeededWorkItemExecutionTab(projectSlug, projectName, createdShortId);
    await waitForStartAgentBlockedOrCompleted(
      projectSlug,
      createdShortId,
      activeSessionId,
      "routine-created active lock after UI reset/reopen",
    );

    unwrap(
      await invokeE2E("openSession", activeSessionId),
      "openSession(routine-created Work Item)",
    );
    await waitForVisibleSelector(
      '[data-testid="chat-panel"]',
      "Routine-created Work Item LLM chat panel",
      MOUNT_TIMEOUT_MS,
    );
    await browser.waitUntil(
      async () => {
        const text = await execJS(`return document.body.innerText || "";`);
        return (
          text.includes(routineWorkItemTitle) ||
          text.includes(createdShortId) ||
          text.includes("Routine-created Work Item rendered UI LLM execution probe")
        );
      },
      {
        timeout: 30_000,
        timeoutMsg: "Routine-created Work Item prompt context was not visible in rendered chat",
      },
    );
    await waitForRenderedAssistantReply(
      "Routine-created Work Item rendered UI LLM execution",
      activeSessionId,
    );
    await waitForSessionAggregateRow(
      activeSessionId,
      (session) => session.status !== "running",
      "Routine-created Work Item session leaves running after assistant reply",
    );
    await waitForWorkItemLockCleared(
      projectSlug,
      createdShortId,
      activeSessionId,
      "completed Routine-created Work Item session",
    );

    unwrap(
      await invokeE2E("agentOrgSimulateAppRestart"),
      "simulate app restart for Routine-created Work Item session",
    );
    await waitForSessionAggregateRow(
      activeSessionId,
      (session) => session.sessionId === activeSessionId,
      "Routine-created Work Item session retained after simulated app restart",
    );
    const postRestartItem = unwrap(
      await invokeE2E("readWorkItem", projectSlug, createdShortId),
      "readWorkItem(post-restart Routine-created Work Item)",
    ).item;
    if (postRestartItem.frontmatter.execution_lock?.activeSessionId === activeSessionId) {
      throw new Error(
        `Simulated app restart resurrected stale Routine-created Work Item lock: ${JSON.stringify(postRestartItem.frontmatter.execution_lock)}`,
      );
    }

    unwrap(
      await invokeE2E("resetToNewSession"),
      "resetToNewSession(routine-created after restart)",
    );
    await openSeededWorkItemExecutionTab(projectSlug, projectName, createdShortId);
    await waitForStartButtonState(
      "enabled",
      "post-restart Routine-created completed Work Item execution tab",
    );
  });

  it("starts a completed Work Item again as a separate rendered LLM session", async function () {
    if (!shouldRunScenario(WORK_ITEM_RERUN_UI_LLM_SCENARIO)) {
      this.skip();
      return;
    }

    const accounts = unwrap(
      await invokeE2E("listAccounts"),
      "listAccounts(work item rerun ui llm)",
    ).accounts;
    const account = selectRustAgentAccount(accounts);
    if (!account) {
      if (isScenarioExplicitlyRequested(WORK_ITEM_RERUN_UI_LLM_SCENARIO)) {
        throw new Error(
          `No enabled Rust-agent account matched agentType=${API_AGENT_TYPE} model=${PREFERRED_API_MODEL_ID} account=${API_ACCOUNT_NAME ?? "<any>"}`,
        );
      }
      this.skip();
      return;
    }

    const repo = unwrap(
      await invokeE2E("ensureRepoSelected", { repoPath: E2E_REPO_PATH }),
      "ensureRepoSelected(work item rerun ui llm)",
    );
    const projectSlug = `e2e-work-item-rerun-${RUN_ID}`;
    const projectName = `E2E Work Item Rerun ${RUN_ID}`;
    const shortId = `RERUN-${RUN_ID}`;
    const workItemTitle = `E2E rerunnable LLM work item ${RUN_ID}`;

    await invokeE2E("deleteProject", projectSlug);
    unwrap(
      await invokeE2E(
        "writeProject",
        projectSlug,
        createProjectMeta(projectSlug, projectName, repo.path),
        "E2E project for Work Item rerun LLM execution.",
        true,
      ),
      "writeProject(work item rerun ui llm)",
    );
    unwrap(
      await invokeE2E(
        "writeWorkItem",
        projectSlug,
        shortId,
        createWorkItemFrontmatter({ shortId, title: workItemTitle, account }),
        "Rerunnable Work Item LLM execution probe. Reply briefly and do not modify files.",
      ),
      "writeWorkItem(work item rerun ui llm)",
    );

    const firstSessionId = await startWorkItemRunFromUi(
      projectSlug,
      projectName,
      shortId,
      "first rerun scenario",
    );
    await waitForSessionAggregateRow(
      firstSessionId,
      (session) =>
        session.sessionId === firstSessionId &&
        session.category === "rust_agent" &&
        session.model === PREFERRED_API_MODEL_ID &&
        session.accountId === account.id &&
        session.workItemId === shortId &&
        session.projectSlug === projectSlug &&
        session.workspacePath === repo.path,
      "first Work Item rerun scenario session aggregate",
    );

    unwrap(
      await invokeE2E("openSession", firstSessionId),
      "openSession(first Work Item rerun scenario)",
    );
    await waitForVisibleSelector(
      '[data-testid="chat-panel"]',
      "first Work Item rerun scenario chat panel",
      MOUNT_TIMEOUT_MS,
    );
    await waitForRenderedAssistantReply(
      "first Work Item rerun scenario",
      firstSessionId,
    );
    await waitForSessionAggregateRow(
      firstSessionId,
      (session) => session.status !== "running",
      "first Work Item rerun scenario leaves running",
    );
    await waitForWorkItemLockCleared(
      projectSlug,
      shortId,
      firstSessionId,
      "first Work Item rerun scenario completed session",
    );

    unwrap(await invokeE2E("resetToNewSession"), "resetToNewSession(before second rerun)");
    const secondSessionId = await startWorkItemRunFromUi(
      projectSlug,
      projectName,
      shortId,
      "second rerun scenario",
    );
    if (secondSessionId === firstSessionId) {
      throw new Error(
        `Second Work Item run reused first session id: ${firstSessionId}`,
      );
    }
    await waitForSessionAggregateRow(
      secondSessionId,
      (session) =>
        session.sessionId === secondSessionId &&
        session.category === "rust_agent" &&
        session.model === PREFERRED_API_MODEL_ID &&
        session.accountId === account.id &&
        session.workItemId === shortId &&
        session.projectSlug === projectSlug &&
        session.workspacePath === repo.path,
      "second Work Item rerun scenario session aggregate",
    );
    const secondLockedItem = await waitForWorkItemLock(
      projectSlug,
      shortId,
      "second rerun scenario active lock",
    );
    if (secondLockedItem.frontmatter.execution_lock.activeSessionId !== secondSessionId) {
      throw new Error(
        `Second Work Item run lock did not point at second session: ${JSON.stringify(secondLockedItem.frontmatter.execution_lock)}`,
      );
    }

    unwrap(
      await invokeE2E("openSession", secondSessionId),
      "openSession(second Work Item rerun scenario)",
    );
    await waitForVisibleSelector(
      '[data-testid="chat-panel"]',
      "second Work Item rerun scenario chat panel",
      MOUNT_TIMEOUT_MS,
    );
    await waitForRenderedAssistantReply(
      "second Work Item rerun scenario",
      secondSessionId,
    );
    await waitForSessionAggregateRow(
      secondSessionId,
      (session) => session.status !== "running",
      "second Work Item rerun scenario leaves running",
    );
    await waitForWorkItemLockCleared(
      projectSlug,
      shortId,
      secondSessionId,
      "second Work Item rerun scenario completed session",
    );

    await waitForSessionAggregateRow(
      firstSessionId,
      (session) => session.sessionId === firstSessionId && session.status !== "running",
      "first Work Item rerun scenario remains durable after second run",
    );
  });

  it("starts a Work Item LLM session from rendered UI and reflects the execution lock", async function () {
    if (!shouldRunScenario(WORK_ITEM_UI_LLM_SCENARIO)) {
      this.skip();
      return;
    }

    const accounts = unwrap(
      await invokeE2E("listAccounts"),
      "listAccounts(ui llm)",
    ).accounts;
    const account = selectRustAgentAccount(accounts);
    if (!account) {
      if (isScenarioExplicitlyRequested(WORK_ITEM_UI_LLM_SCENARIO)) {
        throw new Error(
          `No enabled Rust-agent account matched agentType=${API_AGENT_TYPE} model=${PREFERRED_API_MODEL_ID} account=${API_ACCOUNT_NAME ?? "<any>"}`,
        );
      }
      this.skip();
      return;
    }

    const repo = unwrap(
      await invokeE2E("ensureRepoSelected", { repoPath: E2E_REPO_PATH }),
      "ensureRepoSelected(ui llm)",
    );
    const projectSlug = `e2e-work-item-ui-${RUN_ID}`;
    const projectName = `E2E Work Item UI ${RUN_ID}`;
    const shortId = `E2E-${RUN_ID}`;
    const workItemTitle = `E2E rendered LLM work item ${RUN_ID}`;

    await invokeE2E("deleteProject", projectSlug);
    unwrap(
      await invokeE2E(
        "writeProject",
        projectSlug,
        createProjectMeta(projectSlug, projectName, repo.path),
        "E2E project for rendered Work Item LLM execution.",
        true,
      ),
      "writeProject(ui llm)",
    );
    unwrap(
      await invokeE2E(
        "writeWorkItem",
        projectSlug,
        shortId,
        createWorkItemFrontmatter({ shortId, title: workItemTitle, account }),
        "Rendered UI LLM execution probe. Run a harmless short wait before your final answer if tools are available, then reply briefly. Do not modify files.",
      ),
      "writeWorkItem(ui llm)",
    );

    await openSeededWorkItemExecutionTab(projectSlug, projectName, shortId);
    await waitForStartButtonState("enabled", "initial rendered Work Item execution tab");

    const startSelector = '[data-testid="work-item-start-agent-button"]';
    const startClick = await clickSelector(startSelector);
    if (startClick !== "clicked") {
      throw new Error(`Start Agent click failed: ${startClick}`);
    }

    const lockedItem = await waitForWorkItemLock(
      projectSlug,
      shortId,
      "rendered Start Agent click",
    );
    const activeSessionId = lockedItem.frontmatter.execution_lock.activeSessionId;

    await waitForSessionAggregateRow(
      activeSessionId,
      (session) =>
        session.sessionId === activeSessionId &&
        session.category === "rust_agent" &&
        session.model === PREFERRED_API_MODEL_ID &&
        session.accountId === account.id &&
        session.workItemId === shortId &&
        session.projectSlug === projectSlug &&
        session.workspacePath === repo.path,
      "Work Item launched session aggregate linkage",
    );

    const duplicateClick = await clickSelector(startSelector);
    if (duplicateClick !== "disabled" && duplicateClick !== "missing") {
      throw new Error(
        `Duplicate Start Agent click should be blocked by active lock, got: ${duplicateClick}`,
      );
    }
    const afterDuplicateItem = await waitForWorkItemLock(
      projectSlug,
      shortId,
      "duplicate click should not replace lock",
    );
    if (
      afterDuplicateItem.frontmatter.execution_lock.activeSessionId !==
      activeSessionId
    ) {
      throw new Error(
        `Duplicate Start Agent changed active session id: before=${activeSessionId} after=${JSON.stringify(afterDuplicateItem.frontmatter.execution_lock)}`,
      );
    }

    unwrap(await invokeE2E("resetToNewSession"), "resetToNewSession(active lock)");
    await openSeededWorkItemExecutionTab(projectSlug, projectName, shortId);
    const reopenState = await waitForStartAgentBlockedOrCompleted(
      projectSlug,
      shortId,
      activeSessionId,
      "active lock after UI reset/reopen",
    );
    const afterActiveReopenItem = reopenState.itemResult.item;
    const afterActiveReopenLock =
      afterActiveReopenItem.frontmatter.execution_lock?.activeSessionId;
    if (afterActiveReopenLock && afterActiveReopenLock !== activeSessionId) {
      throw new Error(
        `Active lock changed after UI reset/reopen: ${JSON.stringify(afterActiveReopenItem.frontmatter.execution_lock)}`,
      );
    }

    unwrap(
      await invokeE2E("openSession", activeSessionId),
      "openSession(ui llm work item)",
    );
    await waitForVisibleSelector(
      '[data-testid="chat-panel"]',
      "Work Item LLM chat panel",
      MOUNT_TIMEOUT_MS,
    );
    await browser.waitUntil(
      async () => {
        const text = await execJS(`return document.body.innerText || "";`);
        return text.includes(workItemTitle) || text.includes(shortId) || text.includes("Rendered UI LLM execution probe");
      },
      { timeout: 30_000, timeoutMsg: "Work Item prompt context was not visible in rendered chat" },
    );
    await waitForRenderedAssistantReply(
      "Work Item rendered UI LLM execution",
      activeSessionId,
    );
    await waitForSessionAggregateRow(
      activeSessionId,
      (session) => session.status !== "running",
      "Work Item launched session leaves running after assistant reply",
    );
    await waitForWorkItemLockCleared(
      projectSlug,
      shortId,
      activeSessionId,
      "completed Work Item session",
    );

    unwrap(await invokeE2E("resetToNewSession"), "resetToNewSession(ui llm)");
    unwrap(
      await invokeE2E("openSession", activeSessionId),
      "reopen Work Item LLM session after reset",
    );
    await waitForVisibleSelector(
      '[data-testid="chat-panel"]',
      "reopened Work Item LLM chat panel",
      MOUNT_TIMEOUT_MS,
    );
    await browser.waitUntil(
      async () => {
        const text = await execJS(`return document.body.innerText || "";`);
        return text.includes(workItemTitle) || text.includes(shortId) || text.includes("Rendered UI LLM execution probe");
      },
      { timeout: RENDER_TIMEOUT_MS, timeoutMsg: "Work Item transcript context disappeared after reopen" },
    );

    await openSeededWorkItemExecutionTab(projectSlug, projectName, shortId);
    await browser.waitUntil(
      async () => {
        const text = await execJS(`return document.body.innerText || "";`);
        return text.includes("Completed") || text.includes("completed");
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        timeoutMsg: "Completed Work Item execution tab did not render completed state",
      },
    );
    const reopenedItem = unwrap(
      await invokeE2E("readWorkItem", projectSlug, shortId),
      "readWorkItem(reopened completed Work Item)",
    ).item;
    if (reopenedItem.frontmatter.execution_lock?.activeSessionId === activeSessionId) {
      throw new Error(
        `Completed Work Item retained stale lock: ${JSON.stringify(reopenedItem.frontmatter.execution_lock)}`,
      );
    }

    unwrap(
      await invokeE2E("agentOrgSimulateAppRestart"),
      "simulate app restart for Work Item session",
    );
    await waitForSessionAggregateRow(
      activeSessionId,
      (session) => session.sessionId === activeSessionId,
      "Work Item session retained after simulated app restart",
    );
    const postRestartItem = unwrap(
      await invokeE2E("readWorkItem", projectSlug, shortId),
      "readWorkItem(post-restart Work Item)",
    ).item;
    if (postRestartItem.frontmatter.execution_lock?.activeSessionId === activeSessionId) {
      throw new Error(
        `Simulated app restart resurrected stale Work Item lock: ${JSON.stringify(postRestartItem.frontmatter.execution_lock)}`,
      );
    }

    unwrap(await invokeE2E("resetToNewSession"), "resetToNewSession(after restart)");
    unwrap(
      await invokeE2E("openSession", activeSessionId),
      "reopen Work Item session after simulated restart",
    );
    await waitForVisibleSelector(
      '[data-testid="chat-panel"]',
      "post-restart Work Item chat panel",
      MOUNT_TIMEOUT_MS,
    );
    await openSeededWorkItemExecutionTab(projectSlug, projectName, shortId);
    await waitForStartButtonState("enabled", "post-restart completed Work Item execution tab");
  });
});
