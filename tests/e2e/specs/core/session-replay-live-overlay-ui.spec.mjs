import {
  execJS,
  invokeE2E,
  unwrap,
  waitForApp,
} from "../../support/core/session/agentQueuedFollowupDriver.mjs";

const RENDER_TIMEOUT_MS = 12_000;
const SESSION_ID = `e2e-session-replay-live-overlay-${Date.now()}`;
const EVENT_ID = `${SESSION_ID}-list-dir`;
const WORKSPACE_PATH = "/repo";

function makeUserEvent(createdAt) {
  return {
    id: `${SESSION_ID}-user`,
    chunk_id: `${SESSION_ID}-user`,
    sessionId: SESSION_ID,
    createdAt,
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "raw",
    args: {},
    result: {
      type: "user",
      message: "List the fixture directory",
      is_delta: false,
    },
    source: "user",
    displayText: "List the fixture directory",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
}

function makeListDirEvent(createdAt, overrides = {}) {
  return {
    id: EVENT_ID,
    chunk_id: EVENT_ID,
    sessionId: SESSION_ID,
    createdAt,
    functionName: "list_dir",
    uiCanonical: "list_dir",
    actionType: "tool_call",
    args: { path: WORKSPACE_PATH },
    result: {},
    source: "assistant",
    displayText: `List ${WORKSPACE_PATH}`,
    displayStatus: "running",
    displayVariant: "tool_call",
    activityStatus: "agent",
    isDelta: false,
    ...overrides,
  };
}

async function seed(events) {
  unwrap(
    await invokeE2E("seedChatEvents", SESSION_ID, events, {
      chatPanelMaximized: false,
      chatWidth: 460,
      currentEventId: EVENT_ID,
      selectedApp: "CODE_EDITOR",
      stationMode: "agent-station",
    }),
    "seedChatEvents"
  );
}

async function replayPanelSnapshot() {
  return execJS(`
    const replay = document.querySelector('.session-replay-ide') ||
      Array.from(document.querySelectorAll('.ide-code-panel, .code-viewer-scroll-container'))
        .map((node) => node.closest('.session-replay-ide') || node)
        .find(Boolean);
    const text = replay ? (replay.innerText || '') : '';
    return {
      hasReplay: !!replay,
      text,
      bodyText: (document.body.innerText || '').slice(0, 5000),
      testIds: Array.from(document.querySelectorAll('[data-testid]'))
        .map((node) => node.getAttribute('data-testid'))
        .filter(Boolean)
        .slice(-120),
    };
  `);
}

async function waitForReplayText(assertion, label) {
  await browser.waitUntil(
    async () => assertion(await replayPanelSnapshot()),
    {
      timeout: RENDER_TIMEOUT_MS,
      interval: 250,
      timeoutMsg: `${label}: ${JSON.stringify(await replayPanelSnapshot())}`,
    }
  );
}

describe("SessionReplay live operation overlay UI", () => {
  before(async () => {
    await waitForApp();
    unwrap(
      await invokeE2E("navigateTo", "/orgii/workstation/code"),
      "navigateTo workstation code"
    );
  });

  beforeEach(async () => {
    unwrap(
      await invokeE2E("navigateTo", "/orgii/workstation/code"),
      "navigateTo workstation code before reset"
    );
    unwrap(await invokeE2E("resetToNewSession"), "resetToNewSession");
  });

  it("hydrates an in-place list_dir event from running placeholder to completed results", async () => {
    const baseTime = Date.now();
    const userEvent = makeUserEvent(new Date(baseTime).toISOString());
    const runningEvent = makeListDirEvent(new Date(baseTime + 1_000).toISOString());

    await seed([userEvent, runningEvent]);
    await waitForReplayText(
      (snapshot) =>
        snapshot.hasReplay &&
        !snapshot.text.includes("README.md") &&
        !snapshot.text.includes("src/"),
      "running list_dir replay panel did not render before hydration"
    );

    const completedEvent = makeListDirEvent(runningEvent.createdAt, {
      result: { output: "[dir] src/\n[file] README.md" },
      displayStatus: "completed",
      activityStatus: "agent",
    });

    await seed([userEvent, completedEvent]);
    await waitForReplayText(
      (snapshot) =>
        snapshot.hasReplay &&
        snapshot.text.includes("List directory") &&
        snapshot.text.includes("README.md") &&
        snapshot.text.includes("src/"),
      "completed list_dir replay panel did not hydrate rendered results"
    );

    const finalSnapshot = await replayPanelSnapshot();
    expect(finalSnapshot.text).toContain("README.md");
    expect(finalSnapshot.text).toContain("src/");
  });
});
