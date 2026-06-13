/* global describe, before, after, it, browser */
/**
 * Subagent cell planning-footer UI spec.
 *
 * Regression coverage for "the last block in a monitor cell sits static
 * while the subagent is still working": session-scoped ChatHistory
 * instances previously drove the "Planning next step…" footer from the
 * GLOBAL active-session atoms, so the footer was structurally dead (or
 * read the parent's state) inside subagent monitor cells.
 *
 * Pipeline under test (live production code; only seeding is debug):
 *   debug_seed_child_session → useSubagentSessions (endedAtMs) →
 *   SubagentPipCard isSessionLive → IndependentGridCell →
 *   SubagentChatPane planningIndicatorScope →
 *   usePlanningIndicator(scope) ← sessionScopedPlanningMetaAtomFamily
 *   (per-session snapshot channel) → PlanningFooter
 *
 * Assertions:
 *   1. A LIVE subagent cell whose last event is settled (no running row)
 *      shows the planning footer inside the cell.
 *   2. A TERMINAL subagent cell never shows the footer.
 */
import {
  execJS,
  invokeE2E,
  unwrap,
  waitForApp,
} from "../../support/core/session/agentQueuedFollowupDriver.mjs";

const RENDER_TIMEOUT_MS = 20_000;
const RUN_ID = Date.now();
const PARENT_SESSION_ID = `sdeagent-e2e-cell-footer-${RUN_ID}`;
const LIVE_CHILD_ID = `agent-builtin:explore-e2e-live-${RUN_ID}`;
const DONE_CHILD_ID = `agent-builtin:explore-e2e-done-${RUN_ID}`;

const LIVE_TASK = `CellFooterLive${RUN_ID}`;
const DONE_TASK = `CellFooterDone${RUN_ID}`;

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

// A settled (completed) explore tool event — the exact "dead last block"
// shape from the regression: grep finished, next tool not started yet.
function makeSettledGrepEvent(sessionId, createdAt, marker) {
  return {
    id: `${sessionId}-grep`,
    chunk_id: `${sessionId}-grep`,
    sessionId,
    createdAt,
    functionName: "code_search",
    uiCanonical: "code_search",
    actionType: "grep",
    args: { action: "grep", pattern: marker },
    result: { content: `1 match for ${marker}` },
    source: "assistant",
    displayText: `Grep ${marker}`,
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "processed",
    isDelta: false,
  };
}

async function seedFixture() {
  // Children rows (wire): one open clip (running, endedAt=null via
  // updatedAt=now), one terminal clip.
  unwrap(
    await invokeE2E("debugSeedChildSessionWire", {
      parentSessionId: PARENT_SESSION_ID,
      sessionId: LIVE_CHILD_ID,
      name: `Explore (${LIVE_TASK})`,
      status: "running",
      createdAt: atOffset(1),
      updatedAt: new Date().toISOString(),
    }),
    "seed live child"
  );
  unwrap(
    await invokeE2E("debugSeedChildSessionWire", {
      parentSessionId: PARENT_SESSION_ID,
      sessionId: DONE_CHILD_ID,
      name: `Explore (${DONE_TASK})`,
      status: "completed",
      createdAt: atOffset(1),
      updatedAt: atOffset(4),
    }),
    "seed done child"
  );

  // Child chat events: settled grep as the last (and only) tool event.
  unwrap(
    await invokeE2E("seedChatEvents", LIVE_CHILD_ID, [
      makeUserEvent(LIVE_CHILD_ID, atOffset(1), `Audit ${LIVE_TASK}`),
      makeSettledGrepEvent(LIVE_CHILD_ID, atOffset(2), LIVE_TASK),
    ]),
    "seed live child events"
  );
  unwrap(
    await invokeE2E("seedChatEvents", DONE_CHILD_ID, [
      makeUserEvent(DONE_CHILD_ID, atOffset(1), `Audit ${DONE_TASK}`),
      makeSettledGrepEvent(DONE_CHILD_ID, atOffset(2), DONE_TASK),
    ]),
    "seed done child events"
  );

  // Parent last: makes the monitor strip discover the children. Seeding
  // the parent LAST also restores it as the active session so the strip
  // renders against the parent surface.
  unwrap(
    await invokeE2E(
      "seedChatEvents",
      PARENT_SESSION_ID,
      [
        makeUserEvent(PARENT_SESSION_ID, atOffset(0), "Run the audit"),
        makeSettledGrepEvent(PARENT_SESSION_ID, atOffset(1), "parent-grep"),
      ],
      {
        chatPanelMaximized: false,
        chatWidth: 460,
        stationMode: "agent-station",
        runtimeStatus: "running",
      }
    ),
    "seed parent events"
  );
}

async function footerSnapshot() {
  return execJS(`
    const cells = Array.from(document.querySelectorAll('[data-testid="chat-message-list"]'));
    const findCell = (marker) => cells.find((cell) => (cell.innerText || '').includes(marker));
    const liveCell = findCell(${JSON.stringify(LIVE_TASK)});
    const doneCell = findCell(${JSON.stringify(DONE_TASK)});
    const hasFooter = (cell) =>
      Boolean(cell && cell.querySelector('[data-testid="planning-footer"]'));
    return {
      cellCount: cells.length,
      liveCellFound: !!liveCell,
      doneCellFound: !!doneCell,
      liveCellHasFooter: hasFooter(liveCell),
      doneCellHasFooter: hasFooter(doneCell),
      bodyPreview: (document.body.innerText || '').slice(0, 2000),
    };
  `);
}

async function waitForFooterState(assertion, label) {
  await browser.waitUntil(async () => assertion(await footerSnapshot()), {
    timeout: RENDER_TIMEOUT_MS,
    interval: 400,
    timeoutMsg: `${label}: ${JSON.stringify(await footerSnapshot()).slice(0, 1500)}`,
  });
}

describe("Subagent cell planning footer UI", () => {
  before(async () => {
    await waitForApp();
    unwrap(
      await invokeE2E("navigateTo", "/orgii/workstation/code"),
      "navigateTo workstation code"
    );
    unwrap(await invokeE2E("resetToNewSession"), "resetToNewSession");
    await seedFixture();
  });

  after(async () => {
    await invokeE2E("deleteSessionWire", LIVE_CHILD_ID);
    await invokeE2E("deleteSessionWire", DONE_CHILD_ID);
    await invokeE2E("deleteSessionWire", PARENT_SESSION_ID);
  });

  it("shows the planning footer in a live cell whose last block is settled", async () => {
    await waitForFooterState(
      (snap) => snap.liveCellFound,
      "live subagent cell should render"
    );
    // The footer arms after IDLE_THRESHOLD_MS (1s) without store
    // mutations; the waitUntil poll absorbs that.
    await waitForFooterState(
      (snap) => snap.liveCellHasFooter,
      "live cell with settled last block should show the planning footer"
    );
  });

  it("never shows the footer in a terminal cell", async () => {
    await waitForFooterState(
      (snap) => snap.doneCellFound,
      "terminal subagent cell should render"
    );
    // Steady-state check: live cell footer on, terminal cell footer off.
    await waitForFooterState(
      (snap) => snap.liveCellHasFooter && !snap.doneCellHasFooter,
      "terminal cell must not animate a planning footer"
    );
  });
});
