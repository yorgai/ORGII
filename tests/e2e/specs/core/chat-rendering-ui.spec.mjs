/**
 * chat-rendering-ui.spec.mjs
 *
 * Rendered UI compatibility ledger for Rust tool-call metadata.
 * Pulls the same `list_all_tools` rows used by the app, seeds transcript
 * events through the real EventStore path, and verifies every selected
 * tool sentinel appears in ChatHistory. Tools are checked in small batches so
 * virtualization does not hide off-screen rows from the assertion.
 */

const MOUNT_TIMEOUT_MS = 60_000;
const RENDER_TIMEOUT_MS = 12_000;
const RUN_ID = Date.now();
const BATCH_SIZE = 6;
const E2E_REPO_PATH = process.env.E2E_REPO_PATH ?? "/tmp/orgii-e2e-workspace-repo";
const SCENARIO_FILTER = (process.env.E2E_CHAT_RENDERING_SCENARIOS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function shouldRunScenario(name) {
  return SCENARIO_FILTER.length === 0 || SCENARIO_FILTER.includes(name);
}

const SKIP_CHAT_TOOLS = new Set([
  "agent",
  "create_plan",
  "manage_todo",
  "ask_user_questions",
  "suggest_next_steps",
  "suggest_mode_switch",
  "ask_user_permissions",
  "thinking",
  "agent_message",
  "user_message",
  "subagent",
  "mcp_tool",
  "tool_call",
]);

async function execJS(script) {
  return browser.executeScript(script, []);
}

async function waitForFrontendReady() {
  const port = process.env.E2E_FRONTEND_PORT ?? "1998";
  const url = `http://127.0.0.1:${port}`;
  await browser.waitUntil(
    async () => {
      try {
        const response = await fetch(url, { method: "GET" });
        return response.ok;
      } catch {
        return false;
      }
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      timeoutMsg: `frontend dev server never became ready at ${url}`,
    }
  );
}

async function invokeE2E(method, ...args) {
  return browser.executeAsyncScript(
    `
    const cb = arguments[arguments.length - 1];
    const method = arguments[0];
    const rest = Array.prototype.slice.call(arguments, 1, arguments.length - 1);
    if (!window.__e2e || typeof window.__e2e[method] !== "function") {
      cb({ ok: false, error: "window.__e2e." + method + " not available" });
      return;
    }
    Promise.resolve(window.__e2e[method].apply(null, rest))
      .then(cb)
      .catch((e) => cb({ ok: false, error: String(e && e.message || e) }));
  `,
    [method, ...args]
  );
}

function makeUserEvent(sessionId, batchIndex) {
  return {
    id: `user-tool-ledger-${batchIndex}`,
    chunk_id: `user-tool-ledger-${batchIndex}`,
    sessionId,
    createdAt: new Date().toISOString(),
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "raw",
    args: {},
    result: {
      type: "user",
      message: `Render tool ledger batch ${batchIndex}`,
      is_delta: false,
    },
    source: "user",
    displayText: `Render tool ledger batch ${batchIndex}`,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
}

function makeToolEvent(sessionId, batchIndex, toolIndex, tool) {
  const sentinel = `TOOL_LEDGER_${batchIndex}_${toolIndex}_${tool.name}`;
  const actionName =
    tool.name === "agent"
      ? "delegate"
      : Array.isArray(tool.actions) && tool.actions.length > 0
        ? tool.actions[0].name
        : "run";
  const args = {
    action: actionName,
    command: `printf '${sentinel}'`,
    query: sentinel,
    path: `/tmp/${tool.name}.txt`,
    content: sentinel,
    url: "https://example.com",
    description: `Delegate ${sentinel}`,
    subagent_type: "explore",
    subagentSessionId: `${sessionId}-child-${toolIndex}`,
    prompt: sentinel,
  };
  const result = {
    success: true,
    status: "completed",
    is_delta: false,
    observation: sentinel,
    output: sentinel,
    stdout: sentinel,
    content: sentinel,
  };

  if (tool.chatBlock === "diff" || tool.name === "apply_patch") {
    args.patch_text = [
      "*** Begin Patch",
      `*** Add File: src/${tool.name}-${batchIndex}-${toolIndex}.ts`,
      `+export const marker = \"${sentinel}\";`,
      "*** End Patch",
    ].join("\n");
    result.content = `Applied patch ${sentinel}`;
    result.observation = result.content;
  }

  if (tool.chatBlock === "sent_message") {
    args.recipient_name = `Recipient ${toolIndex}`;
    args.kind = "plain";
    args.summary = sentinel;
    args.text = sentinel;
  }

  if (tool.name === "read_file") {
    result.content = `export const marker = "${sentinel}";`;
    result.observation = result.content;
  }

  return {
    id: `tool-ledger-${batchIndex}-${toolIndex}-${tool.name}`,
    chunk_id: `tool-ledger-${batchIndex}-${toolIndex}-${tool.name}`,
    sessionId,
    createdAt: new Date(Date.now() + toolIndex).toISOString(),
    functionName: tool.name,
    uiCanonical: tool.name,
    actionType: "tool_call",
    args,
    result,
    source: "assistant",
    displayText: sentinel,
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "agent",
    isDelta: false,
  };
}

function makeAssistantEvent(sessionId, batchIndex) {
  const content = `Tool render ledger batch ${batchIndex} complete.`;
  return {
    id: `assistant-tool-ledger-${batchIndex}`,
    chunk_id: `assistant-tool-ledger-${batchIndex}`,
    sessionId,
    createdAt: new Date(Date.now() + 10_000).toISOString(),
    functionName: "assistant_message",
    uiCanonical: "agent_message",
    actionType: "assistant",
    args: {},
    result: {
      content,
      observation: content,
      is_delta: false,
      role: "assistant",
    },
    source: "assistant",
    displayText: content,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
    isDelta: false,
  };
}

function renderableToolsFromMetadata(tools) {
  return tools
    .filter(
      (tool) =>
        typeof tool.name === "string" &&
        !tool.hidden &&
        !SKIP_CHAT_TOOLS.has(tool.name)
    )
    .filter(
      (tool) =>
        tool.chatBlock &&
        tool.chatBlock !== "diff" &&
        tool.chatBlock !== "title_only" &&
        tool.appSubtool !== "file_write" &&
        tool.appSubtool !== "todo" &&
        tool.appSubtool !== "other_interactions"
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function waitForApp() {
  await waitForFrontendReady();
  await browser.setTimeout({ script: 5_000 });
  await execJS(`localStorage.setItem('orgii:auth_skipped', '1'); return true;`);
  await browser.waitUntil(
    async () => {
      try {
        return await execJS(
          `return document.readyState === 'complete' || document.readyState === 'interactive';`
        );
      } catch {
        return false;
      }
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      timeoutMsg: "app document never became script-readable",
    }
  );
  await browser.waitUntil(
    async () => {
      try {
        return await execJS(
          `return !!document.querySelector('[data-testid="chat-panel"]');`
        );
      } catch {
        return false;
      }
    },
    { timeout: MOUNT_TIMEOUT_MS, timeoutMsg: "chat-panel never mounted" }
  );
  await browser.waitUntil(
    async () => {
      try {
        return await execJS(
          `return !!(window.__e2e && window.__e2e.seedChatEvents && window.__e2e.listAllTools);`
        );
      } catch {
        return false;
      }
    },
    { timeout: 20_000, timeoutMsg: "window.__e2e tool helpers never exposed" }
  );
}

async function renderedToolState(expectedEntries, assistantText) {
  return execJS(`
    const expectedEntries = ${JSON.stringify(expectedEntries)};
    const assistantText = ${JSON.stringify(assistantText)};
    const body = document.body.innerText || '';
    const history = document.querySelector('[data-testid="chat-message-list"]');
    const renderedToolNames = Array.from(document.querySelectorAll('[data-tool-call-name]'))
      .map((node) => node.getAttribute('data-tool-call-name'))
      .filter(Boolean);
    const missing = expectedEntries.filter((entry) => {
      if (body.includes(entry.sentinel)) return false;
      if (entry.fallbackTexts && entry.fallbackTexts.some((text) => body.includes(text))) return false;
      return !renderedToolNames.includes(entry.name);
    });
    return {
      missing: missing.map((entry) => entry.sentinel),
      renderedToolNames,
      visibleCount: expectedEntries.length - missing.length,
      bodyLength: body.length,
      historyText: history ? history.innerText || '' : '',
      chatHistoryCount: history ? history.getAttribute('data-chat-history-count') : null,
      optimizedCount: history ? history.getAttribute('data-optimized-count') : null,
      flatCount: history ? history.getAttribute('data-flat-count') : null,
      groupCounts: history ? history.getAttribute('data-group-counts') : null,
      assistant: body.includes(assistantText),
    };
  `);
}

async function assertBatchRendered(batchIndex, tools) {
  const sessionId = `e2e-render-tools-${RUN_ID}-${batchIndex}`;
  const baseTime = Date.now();
  const userEvent = {
    ...makeUserEvent(sessionId, batchIndex),
    createdAt: new Date(baseTime).toISOString(),
  };
  const toolEvents = tools.map((tool, toolIndex) => ({
    ...makeToolEvent(sessionId, batchIndex, toolIndex, tool),
    createdAt: new Date(baseTime + 1_000 + toolIndex).toISOString(),
  }));
  const assistantEvent = {
    ...makeAssistantEvent(sessionId, batchIndex),
    createdAt: new Date(baseTime + 10_000).toISOString(),
  };
  const expectedEntries = toolEvents.map((event) => ({
    name: event.functionName,
    sentinel: event.displayText,
    fallbackTexts:
      event.functionName === "read_file"
        ? ["Read 1 file", "1 file", event.args?.path].filter(Boolean)
        : event.functionName === "query_lsp"
          ? ["1 LSP query", "LSP query"]
          : event.functionName === "render_inline_canvas"
            ? ["Agent Preview"]
            : undefined,
  }));
  const assistantText = `Tool render ledger batch ${batchIndex} complete.`;
  const seed = await invokeE2E("seedChatEvents", sessionId, [
    userEvent,
    ...toolEvents,
    assistantEvent,
  ]);
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedChatEvents failed for batch ${batchIndex}: ${seed?.error ?? "unknown"}`
    );
  }

  try {
    await browser.waitUntil(
      async () => {
        const state = await renderedToolState(expectedEntries, assistantText);
        return state.missing.length === 0 && state.assistant;
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        timeoutMsg: `metadata-ledger batch ${batchIndex} did not render all expected sentinels`,
      }
    );
  } catch (error) {
    const state = await renderedToolState(expectedEntries, assistantText);
    const metadata = tools.map((tool) => ({
      name: tool.name,
      chatBlock: tool.chatBlock,
      appSubtool: tool.appSubtool,
    }));
    throw new Error(`${error.message}: ${JSON.stringify({ state, metadata })}`);
  }

  const finalState = await renderedToolState(expectedEntries, assistantText);
  expect(finalState.missing).toEqual([]);
  expect(finalState.assistant).toBe(true);
}

const DEDUP_SESSION_ID = `e2e-render-dedup-${Date.now()}`;
const DEDUP_THOUGHT_TEXT = "Can we chat?";
const DEDUP_ANSWER_TEXT =
  "可以。我能用中文和你聊天，也能帮你写代码、查资料、解释技术问题，或一起梳理需求。\n\n你想聊什么？";
const ORDER_SESSION_ID = `e2e-render-thinking-order-${Date.now()}`;
const ORDER_TEXTS = {
  userA: "ORDER_USER_A_chat_first",
  thinkA: "ORDER_THINK_A_before_answer",
  answerA: "ORDER_ANSWER_A_after_thinking",
  userB: "ORDER_USER_B_second_turn",
  thinkB: "ORDER_THINK_B_before_second_answer",
  answerB: "ORDER_ANSWER_B_after_second_thinking",
};

function withCreatedAt(event, timestampMs) {
  return {
    ...event,
    createdAt: new Date(timestampMs).toISOString(),
  };
}

function makeDedupEvent(id, functionName, actionType, displayVariant, content) {
  return {
    id,
    chunk_id: id,
    sessionId: DEDUP_SESSION_ID,
    createdAt: new Date().toISOString(),
    functionName,
    uiCanonical: functionName,
    actionType,
    args: {},
    result: {
      content,
      observation: content,
      is_delta: false,
      role: functionName === "assistant_message" ? "assistant" : undefined,
    },
    source: "assistant",
    displayText: content,
    displayStatus: "completed",
    displayVariant,
    activityStatus: "agent",
    isDelta: false,
  };
}

function makeDedupUserEvent() {
  return {
    id: "user-1",
    chunk_id: "user-1",
    sessionId: DEDUP_SESSION_ID,
    createdAt: new Date().toISOString(),
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "user",
    args: {},
    result: { content: "能聊天吗", observation: "能聊天吗", is_delta: false },
    source: "user",
    displayText: "能聊天吗",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
}

function makeOrderUserEvent(id, content) {
  return {
    id,
    chunk_id: id,
    sessionId: ORDER_SESSION_ID,
    createdAt: new Date().toISOString(),
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "user",
    args: {},
    result: { content, observation: content, is_delta: false },
    source: "user",
    displayText: content,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
}

function makeOrderAssistantEvent(id, displayVariant, content) {
  const isThinking = displayVariant === "thinking";
  return {
    id,
    chunk_id: id,
    sessionId: ORDER_SESSION_ID,
    createdAt: new Date().toISOString(),
    functionName: isThinking ? "thinking" : "assistant_message",
    uiCanonical: isThinking ? "thinking" : "assistant_message",
    actionType: isThinking ? "llm_thinking" : "assistant",
    args: {},
    result: {
      content,
      observation: content,
      is_delta: false,
      role: isThinking ? undefined : "assistant",
    },
    source: "assistant",
    displayText: content,
    displayStatus: "completed",
    displayVariant,
    activityStatus: "agent",
    isDelta: false,
  };
}

async function renderedDedupCounts() {
  const chatState = await invokeE2E("inspectChatState");
  const domState = await execJS(`
    const body = document.body.innerText || "";
    const thoughtMatches = body.match(new RegExp(${JSON.stringify(DEDUP_THOUGHT_TEXT)}, "g")) || [];
    const answerMatches = body.match(new RegExp(${JSON.stringify("可以。我能用中文和你聊天")}, "g")) || [];
    const history = document.querySelector('[data-testid="chat-message-list"]');
    return {
      thought: thoughtMatches.length,
      answer: answerMatches.length,
      assistantBubbles: document.querySelectorAll('[data-testid="chat-message-assistant"]').length,
      body: body.slice(0, 2000),
      chatHistoryDebug: history ? {
        chatHistoryCount: history.getAttribute('data-chat-history-count'),
        optimizedCount: history.getAttribute('data-optimized-count'),
        flatCount: history.getAttribute('data-flat-count'),
        groupCounts: history.getAttribute('data-group-counts'),
        text: (history.innerText || '').slice(0, 500),
      } : null,
      location: window.location.pathname,
    };
  `);
  return { ...domState, chatState };
}

async function assertDedupRenderedOnce() {
  const baseTime = Date.now();
  const seed = await invokeE2E("seedChatEvents", DEDUP_SESSION_ID, [
    withCreatedAt(makeDedupUserEvent(), baseTime),
    withCreatedAt(
      makeDedupEvent(
        "think-1",
        "thinking",
        "llm_thinking",
        "thinking",
        DEDUP_THOUGHT_TEXT
      ),
      baseTime + 1_000
    ),
    withCreatedAt(
      makeDedupEvent(
        "msg-1",
        "assistant_message",
        "assistant",
        "message",
        DEDUP_ANSWER_TEXT
      ),
      baseTime + 2_000
    ),
    withCreatedAt(
      makeDedupEvent(
        "think-2",
        "thinking",
        "llm_thinking",
        "thinking",
        DEDUP_THOUGHT_TEXT
      ),
      baseTime + 3_000
    ),
    withCreatedAt(
      makeDedupEvent(
        "msg-2",
        "assistant_message",
        "assistant",
        "message",
        DEDUP_ANSWER_TEXT
      ),
      baseTime + 4_000
    ),
  ]);
  if (!seed || seed.ok !== true) {
    throw new Error(`seedChatEvents failed: ${seed?.error ?? "unknown"}`);
  }

  try {
    await browser.waitUntil(
      async () => {
        const counts = await renderedDedupCounts();
        return counts.thought === 1 && counts.answer === 1;
      },
      {
        timeout: 10_000,
        timeoutMsg:
          "duplicate thought/answer pair was not collapsed in rendered chat",
      }
    );
  } catch (error) {
    throw new Error(
      `${error.message}: ${JSON.stringify(await renderedDedupCounts())}`
    );
  }

  const finalCounts = await execJS(`
    const body = document.body.innerText || "";
    return {
      thought: (body.match(new RegExp(${JSON.stringify(DEDUP_THOUGHT_TEXT)}, "g")) || []).length,
      answer: (body.match(new RegExp(${JSON.stringify("可以。我能用中文和你聊天")}, "g")) || []).length,
      assistantBubbles: document.querySelectorAll('[data-testid="chat-message-assistant"]').length,
    };
  `);
  expect(finalCounts).toEqual({ thought: 1, answer: 1, assistantBubbles: 1 });
}

async function assertMultiRepoReadPathRendered() {
  const sessionId = `e2e-render-multirepo-read-${Date.now()}`;
  const baseTime = Date.now();
  const primaryPath = `/tmp/orgii-e2e-multirepo-primary-${RUN_ID}/src/index.tsx`;
  const secondaryPath = `/tmp/orgii-e2e-multirepo-secondary-${RUN_ID}/src/index.tsx`;
  const tertiaryPath = `/tmp/orgii-e2e-multirepo-tertiary-${RUN_ID}/README.md`;
  const userEvent = {
    ...withCreatedAt(makeOrderUserEvent("multi-read-user", "Read two files"), baseTime),
    sessionId,
  };
  const readPayloads = [
    {
      path: primaryPath,
      args: { targetFile: primaryPath },
      result: {},
    },
    {
      path: secondaryPath,
      args: { file_path: secondaryPath },
      result: {},
    },
    {
      path: tertiaryPath,
      args: {},
      result: { success: { filePath: tertiaryPath } },
    },
  ];
  const readEvents = readPayloads.map(({ path: targetPath, args, result }, index) => ({
    id: `multi-read-${index}`,
    chunk_id: `multi-read-${index}`,
    sessionId,
    createdAt: new Date(baseTime + 1_000 + index).toISOString(),
    functionName: "read_file",
    uiCanonical: "read_file",
    actionType: "tool_call",
    args,
    result: {
      ...result,
      content: `content for ${targetPath}`,
      observation: `content for ${targetPath}`,
      is_delta: false,
    },
    source: "assistant",
    displayText: `Read ${targetPath}`,
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "agent",
    isDelta: false,
  }));
  const assistantEvent = {
    ...withCreatedAt(
      makeOrderAssistantEvent("multi-read-assistant", "message", "Read complete"),
      baseTime + 3_000
    ),
    sessionId,
  };

  const seed = await invokeE2E("seedChatEvents", sessionId, [
    userEvent,
    ...readEvents,
    assistantEvent,
  ]);
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedChatEvents failed for multi-root read path: ${seed?.error ?? "unknown"}`
    );
  }

  await browser.waitUntil(
    async () => {
      const state = await execJS(`
        const paths = Array.from(document.querySelectorAll('[data-testid="read-file-path"]'))
          .map((node) => node.textContent || "");
        const body = document.body.innerText || "";
        return {
          paths,
          body: body.slice(0, 3000),
          expectedPaths: ${JSON.stringify([primaryPath, secondaryPath, tertiaryPath])},
          hasGenericOnly: paths.some((path) => path.trim() === "file"),
        };
      `);
      return (
        state.expectedPaths.every((expectedPath) =>
          state.body.includes(expectedPath) ||
          state.paths.some((renderedPath) => renderedPath.includes(expectedPath))
        ) && !state.hasGenericOnly
      );
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `multi-root read file paths did not render: ${JSON.stringify(
        await execJS(`
          const paths = Array.from(document.querySelectorAll('[data-testid="read-file-path"]'))
            .map((node) => node.textContent || "");
          return { paths, body: (document.body.innerText || "").slice(0, 3000) };
        `)
      )}`,
    }
  );
}

async function assertThinkingChronologicalOrder() {
  const orderedEventIds = [
    "order-user-a",
    "order-think-a",
    "order-answer-a",
    "order-user-b",
    "order-think-b",
    "order-answer-b",
  ];
  const visibleLatestRoundTexts = [
    ORDER_TEXTS.userB,
    ORDER_TEXTS.thinkB,
    ORDER_TEXTS.answerB,
  ];
  const baseTime = Date.now();
  const seed = await invokeE2E("seedChatEvents", ORDER_SESSION_ID, [
    withCreatedAt(makeOrderUserEvent("order-user-a", ORDER_TEXTS.userA), baseTime),
    withCreatedAt(
      makeOrderAssistantEvent("order-think-a", "thinking", ORDER_TEXTS.thinkA),
      baseTime + 1_000
    ),
    withCreatedAt(
      makeOrderAssistantEvent("order-answer-a", "message", ORDER_TEXTS.answerA),
      baseTime + 2_000
    ),
    withCreatedAt(makeOrderUserEvent("order-user-b", ORDER_TEXTS.userB), baseTime + 3_000),
    withCreatedAt(
      makeOrderAssistantEvent("order-think-b", "thinking", ORDER_TEXTS.thinkB),
      baseTime + 4_000
    ),
    withCreatedAt(
      makeOrderAssistantEvent("order-answer-b", "message", ORDER_TEXTS.answerB),
      baseTime + 5_000
    ),
  ]);
  if (!seed || seed.ok !== true) {
    throw new Error(`seedChatEvents failed: ${seed?.error ?? "unknown"}`);
  }

  await browser.waitUntil(
    async () => {
      const chatState = await invokeE2E("inspectChatState");
      const events = chatState.chatEvents ?? chatState.value?.chatEvents ?? [];
      const eventIds = events.map((event) => event.id);
      const relevantIds = eventIds.filter((eventId) =>
        orderedEventIds.includes(eventId)
      );
      return JSON.stringify(relevantIds) === JSON.stringify(orderedEventIds);
    },
    {
      timeout: 10_000,
      timeoutMsg: `thinking events were not stored in chronological turn order: ${JSON.stringify(
        await invokeE2E("inspectChatState")
      )}`,
    }
  );

  await browser.waitUntil(
    async () => {
      const state = await execJS(`
        const history = document.querySelector('[data-testid="chat-message-list"]');
        const body = history ? (history.innerText || "") : (document.body.innerText || "");
        const texts = ${JSON.stringify(visibleLatestRoundTexts)};
        const indices = texts.map((text) => body.indexOf(text));
        const counts = texts.map((text) => (body.match(new RegExp(text, "g")) || []).length);
        return {
          indices,
          counts,
          inOrder: indices.every((index) => index >= 0) && indices.every((index, idx) => idx === 0 || index > indices[idx - 1]),
          body: body.slice(0, 3000),
        };
      `);
      return state.inOrder && state.counts.every((count) => count === 1);
    },
    {
      timeout: 10_000,
      timeoutMsg: `latest visible thinking round did not render chronologically: ${JSON.stringify(
        await execJS(`
        const history = document.querySelector('[data-testid="chat-message-list"]');
        const body = history ? (history.innerText || "") : (document.body.innerText || "");
        const texts = ${JSON.stringify(visibleLatestRoundTexts)};
        return { indices: texts.map((text) => body.indexOf(text)), body: body.slice(0, 3000) };
      `)
      )}`,
    }
  );
}

describe("Core chat rendering UI", () => {
  before(async () => {
    await waitForApp();
    const repo = await invokeE2E("ensureRepoSelected", {
      repoPath: E2E_REPO_PATH,
      repoName: "E2E Fixture Repo",
    });
    if (!repo || repo.ok !== true) {
      throw new Error(`ensureRepoSelected failed: ${repo?.error ?? "unknown"}`);
    }
    const navigation = await invokeE2E("navigateTo", "/orgii/workstation/code");
    if (!navigation || navigation.ok !== true) {
      throw new Error(`navigateTo failed: ${navigation?.error ?? "unknown"}`);
    }
  });

  it("renders all metadata-ledger tool-call classes from seeded history", async function () {
    if (!shouldRunScenario("metadata-ledger")) {
      this.skip();
      return;
    }

    const toolsResult = await invokeE2E("listAllTools");
    if (!toolsResult || toolsResult.ok !== true) {
      throw new Error(
        `listAllTools failed: ${toolsResult?.error ?? "unknown"}`
      );
    }

    const tools = renderableToolsFromMetadata(toolsResult.tools || []);
    const coveredBlocks = new Set(tools.map((tool) => tool.chatBlock));
    for (const requiredBlock of ["search", "read_file", "shell"]) {
      if (!coveredBlocks.has(requiredBlock)) {
        throw new Error(
          `tool render ledger missing ${requiredBlock}: ${tools.map((tool) => tool.name).join(", ")}`
        );
      }
    }
    const toolNames = new Set(tools.map((tool) => tool.name));
    for (const requiredTool of ["control_browser_with_agent_browser"]) {
      if (!toolNames.has(requiredTool)) {
        throw new Error(
          `tool render ledger missing ${requiredTool}: ${tools.map((tool) => tool.name).join(", ")}`
        );
      }
    }
    if (tools.length < 20) {
      throw new Error(
        `tool render ledger unexpectedly small: ${tools.map((tool) => tool.name).join(", ")}`
      );
    }

    const batches = chunk(tools, BATCH_SIZE);
    for (const [batchIndex, batchTools] of batches.entries()) {
      await assertBatchRendered(batchIndex, batchTools);
    }
  });

  it("renders multi-repo read file targets as paths instead of generic file labels", async function () {
    if (!shouldRunScenario("multi-repo-read-path")) {
      this.skip();
      return;
    }

    await assertMultiRepoReadPathRendered();
  });

  it("renders a duplicated thought/answer segment pair only once", async function () {
    if (!shouldRunScenario("dedup")) {
      this.skip();
      return;
    }

    await assertDedupRenderedOnce();
  });

  it("renders thinking in chronological turn position without duplicates", async function () {
    if (!shouldRunScenario("thinking-order")) {
      this.skip();
      return;
    }

    await assertThinkingChronologicalOrder();
  });
});
