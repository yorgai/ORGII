/* global describe, before, after, it, browser */
/**
 * Composer + planning-footer "background subagent gap" UI spec.
 *
 * Regression coverage for: while a parent turn has mechanically ended
 * (runtime status idle) but a `agent(background: true)` worker is still
 * running, the MAIN composer dropped to Send state and the global planning
 * footer vanished — even though work was clearly ongoing. The fix folds a
 * live-subagent signal (derived from `subagentJobMapAtom`, fed by the real
 * `agent:subagent_job_changed` event) into `isSessionActiveAtom` and the
 * planning-footer gate.
 *
 * Pipeline under test (live production code; only seeding is debug):
 *   seedSubagentJob (→ updateSubagentJobAtom, the same atom the real
 *   agent:subagent_job_changed event drives via handleSubagentJobChanged) →
 *   subagentJobMapAtom → liveSubagentSignalAtom (viewAtom) →
 *   isSessionActiveAtom →
 *     (a) composer chat-send-button data-state="stop"
 *     (b) usePlanningIndicator runtimeCanShowPlanning → planning-footer
 *   terminal status → row dropped → back to Send, footer gone.
 *
 * Assertions:
 *   1. With a live background subagent job AND the parent turn settled
 *      (no running row, runtime idle), the main composer stays in Stop
 *      state and the global planning footer is visible.
 *   2. After the subagent job terminates, the composer returns to Send and
 *      the footer disappears.
 */
import {
  execJS,
  invokeE2E,
  unwrap,
  waitForApp,
} from "../../support/core/session/agentQueuedFollowupDriver.mjs";

const RENDER_TIMEOUT_MS = 20_000;
const RUN_ID = Date.now();
// MUST be `sdeagent-` prefixed: getAdapterForSession resolves the rust
// agent adapter (and thus the channel event handler) by id prefix.
const PARENT_SESSION_ID = `sdeagent-e2e-composer-gap-${RUN_ID}`;
const SUBAGENT_HANDLE = `agent-builtin:explore-gap-${RUN_ID}`;
const AGENT_NAME = `E2E Gap Worker ${RUN_ID}`;

const BASE_MS = Date.now() - 10 * 60 * 1000;
const atOffset = (minutes) =>
  new Date(BASE_MS + minutes * 60_000).toISOString();

function makeUserEvent(sessionId, createdAt, text) {
  return {
    id: `${sessionId}-user`,
    chunk_id: `${sessionId}-user`,
    sessionId,
    createdAt,
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "raw",
    args: {},
    result: { type: "user", message: text, is_delta: false },
    source: "user",
    displayText: text,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
}

// A settled assistant message as the parent's last block — the exact
// gap-window shape: parent said "now I'll wait for the explorers" and the
// turn ended, no running row painted.
function makeSettledAssistantEvent(sessionId, createdAt, text) {
  return {
    id: `${sessionId}-assistant`,
    chunk_id: `${sessionId}-assistant`,
    sessionId,
    createdAt,
    functionName: "assistant_message",
    uiCanonical: "assistant_message",
    actionType: "assistant",
    args: {},
    result: { type: "assistant", message: text, is_delta: false },
    source: "assistant",
    displayText: text,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
}

async function seedParentSettled() {
  // Parent is seeded LAST-as-active with a settled tail and runtime idle —
  // the precise window where the old code showed Send + no footer.
  unwrap(
    await invokeE2E(
      "seedChatEvents",
      PARENT_SESSION_ID,
      [
        makeUserEvent(PARENT_SESSION_ID, atOffset(0), "Run the audit"),
        makeSettledAssistantEvent(
          PARENT_SESSION_ID,
          atOffset(1),
          "Now I'll wait for the explore agents to finish."
        ),
      ],
      {
        chatPanelMaximized: true,
        stationMode: "my-station",
        runtimeStatus: "idle",
      }
    ),
    "seed parent settled events"
  );
}

async function composerSnapshot() {
  return execJS(`
    const sendButton = document.querySelector('[data-testid="chat-send-button"]');
    const footer = document.querySelector('[data-testid="planning-footer"]');
    return {
      sendButtonFound: !!sendButton,
      sendState: sendButton ? sendButton.getAttribute('data-state') : null,
      hasFooter: !!footer,
      bodyPreview: (document.body.innerText || '').slice(0, 1500),
    };
  `);
}

async function waitForComposerState(assertion, label) {
  await browser.waitUntil(async () => assertion(await composerSnapshot()), {
    timeout: RENDER_TIMEOUT_MS,
    interval: 400,
    timeoutMsg: `${label}: ${JSON.stringify(await composerSnapshot()).slice(0, 1200)}`,
  });
}

describe("Composer background-subagent gap UI", () => {
  before(async () => {
    await waitForApp();
    unwrap(
      await invokeE2E("navigateTo", "/orgii/workstation/code"),
      "navigateTo workstation code"
    );
    unwrap(await invokeE2E("resetToNewSession"), "resetToNewSession");
    await seedParentSettled();
    // The session surface must be mounted so useSessionChannel has
    // subscribed to the backend IPC channel before we fire the broadcast.
    await browser.pause(500);
  });

  after(async () => {
    await invokeE2E("seedSubagentJob", {
      sessionId: PARENT_SESSION_ID,
      handle: SUBAGENT_HANDLE,
      agentName: AGENT_NAME,
      subagentType: "delegate",
      status: "completed",
    });
    await invokeE2E("deleteSessionWire", PARENT_SESSION_ID);
  });

  it("keeps the composer in Stop state and shows the footer during the gap", async () => {
    // Baseline: parent settled + idle, no subagent yet → Send, no footer.
    await waitForComposerState(
      (snap) => snap.sendButtonFound && snap.sendState === "submit",
      "composer should start in Send state before any subagent"
    );

    // Seed a live subagent job through `updateSubagentJobAtom` — the exact
    // atom the real `agent:subagent_job_changed("running")` event drives via
    // `handleSubagentJobChanged`. (The Rust→bus→handler hop itself is
    // covered by chat-rendering-ui's wire-path spec; here we isolate the
    // composer/footer gate so the handle stays fully controlled across the
    // running → completed transition.)
    const seed = await invokeE2E("seedSubagentJob", {
      sessionId: PARENT_SESSION_ID,
      handle: SUBAGENT_HANDLE,
      agentName: AGENT_NAME,
      subagentType: "delegate",
      status: "running",
    });
    if (!seed || seed.ok !== true) {
      throw new Error(`seedSubagentJob failed: ${seed?.error ?? "unknown"}`);
    }

    // Now the live-subagent signal must hold the composer in Stop and arm
    // the planning footer, despite parent runtime being idle. The footer
    // arms after IDLE_THRESHOLD_MS (1s); the poll absorbs that.
    await waitForComposerState(
      (snap) => snap.sendState === "stop",
      "composer must stay in Stop while a background subagent runs"
    );
    await waitForComposerState(
      (snap) => snap.hasFooter,
      "planning footer must show during the background-subagent gap"
    );
  });

  it("returns to Send and hides the footer after the subagent ends", async () => {
    // Terminal status drops the row from subagentJobMapAtom — the exact
    // atom path the real `agent:subagent_job_changed("completed")` event
    // takes through `handleSubagentJobChanged` → `updateSubagentJobAtom`.
    unwrap(
      await invokeE2E("seedSubagentJob", {
        sessionId: PARENT_SESSION_ID,
        handle: SUBAGENT_HANDLE,
        agentName: AGENT_NAME,
        subagentType: "delegate",
        status: "completed",
      }),
      "complete subagent job"
    );

    await waitForComposerState(
      (snap) => snap.sendState === "submit" && !snap.hasFooter,
      "composer must return to Send and footer hide once the subagent ends"
    );
  });
});
