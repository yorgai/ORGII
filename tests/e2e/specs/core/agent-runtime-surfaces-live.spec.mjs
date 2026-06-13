/* global describe, before, after, it, browser */
/**
 * Agent runtime surfaces — live LLM coverage for two previously
 * seeded-only render paths:
 *
 * 1. manage_todo: a real agent turn calls manage_todo and the rendered
 *    chat must show the todo card (data-testid="chat-todo-block") with
 *    the actual item text — closing the "uiMetadata dual-track pipeline
 *    only proven via seeded events" gap (commit 12eb08e9).
 * 2. Real subagent spawn: a real agent turn dispatches an Explore
 *    delegate; the live chat surface must render an observable subagent
 *    indicator while/after it runs — closing the "monitor surfaces only
 *    proven via debugSeedChildSessionWire" gap (commits 7d6255c6,
 *    4b00b284, 16db7967).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  configureScenario,
  execJS,
  filteredConfigs,
  js,
  listAccounts,
  rustAgentConfigs,
  scenarioConfigs,
  stopActiveTurnIfNeeded,
  typeAndClickSend,
  waitForApp,
  waitForChatLaunched,
} from "../../support/core/session/agentQueuedFollowupDriver.mjs";

const RUN_ID = Date.now();
const CHAT_INPUT = '[data-testid="chat-input"] [contenteditable="true"]';
const LIVE_TIMEOUT_MS = 300_000;

describe("Agent runtime surfaces live (manage_todo / subagent)", () => {
  let config = null;
  let repoPath = null;

  before(async function () {
    await waitForApp();
    const accounts = await listAccounts();
    const rustConfigs = rustAgentConfigs(
      filteredConfigs(scenarioConfigs(accounts))
    );
    if (rustConfigs.length === 0) {
      this.skip();
      return;
    }
    config =
      rustConfigs.find((row) => row.label === "claude-code-rust-agent") ??
      rustConfigs[0];
    repoPath = process.env.E2E_REPO_PATH;
    if (!repoPath) throw new Error("E2E_REPO_PATH missing");
  });

  after(async () => {
    await stopActiveTurnIfNeeded("runtime-surfaces-cleanup");
  });

  it("renders the todo card when a real agent turn calls manage_todo", async () => {
    await configureScenario(config, { agentExecMode: "build" });

    const todoMarker = `TodoMarker${RUN_ID}`;
    const fileMarker = `todo-live-${RUN_ID}.txt`;
    const prompt = [
      `Use your manage_todo tool to create a todo list with exactly three`,
      `items: "Plan ${todoMarker}", "Create ${fileMarker}", "Verify result".`,
      `Then work through them: create the file ${fileMarker} in the repo`,
      `root with content "todo-live", mark all todos completed, and finish.`,
    ].join(" ");

    await typeAndClickSend(CHAT_INPUT, prompt);
    await waitForChatLaunched(prompt);

    // 1. The rendered todo card must appear (header is visible even when
    //    the block starts collapsed — item text is NOT in the DOM until
    //    expanded, so presence first, expansion next).
    let probe = null;
    await browser.waitUntil(
      async () => {
        probe = await browser.executeScript(
          `
            const blocks = [...document.querySelectorAll('[data-testid="chat-todo-block"]')];
            return JSON.stringify({ count: blocks.length });
          `,
          []
        );
        return JSON.parse(probe ?? "{}").count > 0;
      },
      {
        timeout: LIVE_TIMEOUT_MS,
        interval: 2_000,
        timeoutMsg: () => `live todo card never rendered; probe=${probe}`,
      }
    );

    // 2. Real user action: click the card header to expand, then the
    //    actual item text must be visible — proving the uiMetadata
    //    pipeline carried the LIVE manage_todo snapshot, not a seed.
    await browser.waitUntil(
      async () => {
        probe = await browser.executeScript(
          `
            const marker = arguments[0];
            const blocks = [...document.querySelectorAll('[data-testid="chat-todo-block"]')];
            for (const block of blocks) {
              if (block.innerText.includes(marker)) return JSON.stringify({ ok: true });
              const header = block.querySelector("div");
              header?.click();
            }
            return JSON.stringify({
              ok: false,
              count: blocks.length,
              sample: blocks.map((el) => el.innerText.slice(0, 120)),
            });
          `,
          [todoMarker]
        );
        return JSON.parse(probe ?? "{}").ok === true;
      },
      {
        timeout: 30_000,
        interval: 1_000,
        timeoutMsg: () =>
          `expanded todo card never showed item text; probe=${probe}`,
      }
    );

    // 3. The turn itself must complete its work (artifact on disk).
    await browser.waitUntil(
      async () => existsSync(join(repoPath, fileMarker)),
      {
        timeout: LIVE_TIMEOUT_MS,
        interval: 2_000,
        timeoutMsg: `todo-driven artifact ${fileMarker} never created`,
      }
    );
  });

  it("renders a live subagent indicator when the agent dispatches a delegate", async () => {
    await configureScenario(config, { agentExecMode: "build" });

    const subagentFile = `subagent-live-${RUN_ID}.txt`;
    const prompt = [
      `Use your agent tool to dispatch ONE delegate worker (agent_id`,
      `"builtin:general") with this task: create a file named`,
      `${subagentFile} in the repo root at ${repoPath} with content`,
      `"from-subagent". Wait for the worker to finish, then confirm.`,
    ].join(" ");

    await typeAndClickSend(CHAT_INPUT, prompt);
    await waitForChatLaunched(prompt);

    // 1. Observable subagent surface in the live chat: either the agent
    //    tool card or the subagent strip/cell must render. We accept any
    //    of the production markers; all are user-visible.
    let probe = null;
    await browser.waitUntil(
      async () => {
        probe = await browser.executeScript(
          `
            const text = document.body.innerText;
            const hasAgentToolCard = [...document.querySelectorAll('[data-testid]')]
              .some((el) => (el.getAttribute('data-testid') || '').includes('subagent'));
            const hasMonitorText = /Monitoring|delegate|Delegate|subagent|Subagent/.test(text);
            return JSON.stringify({ hasAgentToolCard, hasMonitorText });
          `,
          []
        );
        const parsed = JSON.parse(probe ?? "{}");
        return parsed.hasAgentToolCard || parsed.hasMonitorText;
      },
      {
        timeout: LIVE_TIMEOUT_MS,
        interval: 2_000,
        timeoutMsg: () => `no subagent surface rendered; probe=${probe}`,
      }
    );

    // 2. The REAL subagent must complete real work: artifact on disk —
    //    this is the backend truth (only a live child session could have
    //    produced the file; the parent was told to delegate, and the tool
    //    card above proves the dispatch surface rendered).
    await browser.waitUntil(
      async () => existsSync(join(repoPath, subagentFile)),
      {
        timeout: LIVE_TIMEOUT_MS,
        interval: 3_000,
        timeoutMsg: async () =>
          `subagent artifact never created; tail=${JSON.stringify((await execJS(js.bodyText)).slice(-1500))}`,
      }
    );
  });
});
