/* global describe, before, after, it, expect, browser */
/**
 * Plan lifecycle decoupled from exec mode — backend-truth spec.
 *
 * Regression coverage for the mode-coupled auto-archive bug: switching the
 * session's exec mode away from Plan used to resolve the pending plan as
 * Abandoned (DB row deleted, Build button dead, session wedged). The
 * decoupled lifecycle keeps the pending plan alive across mode switches;
 * only Build / Skip / supersede / file-or-session deletion terminate it.
 *
 * Wire path under test:
 *   debug_seed_pending_plan (production mark_ready + upsert_session)
 *     → session_patch (the exact RPC the ModePill drives — ex-Chokepoint B)
 *     → agent_get_pending_plan_approval (backend DB-row truth)
 *     → agent_plan_approval_response choice=reject (cross-mode Skip)
 *
 * Only seeding is debug-assisted; the mode switch, the pending query, and
 * the approval response are all live production code paths.
 */
import os from "node:os";
import path from "node:path";

import {
  invokeE2E,
  unwrap,
  waitForApp,
} from "../../support/core/session/agentQueuedFollowupDriver.mjs";

const RUN_ID = Date.now();
const SESSION_ID = `sdeagent-e2e-plan-lifecycle-${RUN_ID}`;
const PLAN_TITLE = `PlanLifecycleDecoupled${RUN_ID}`;
const PLAN_PATH = path.join(
  os.tmpdir(),
  `orgii-e2e-plan-lifecycle-${RUN_ID}.plan.md`
);

async function pendingSnapshot() {
  const result = unwrap(
    await invokeE2E("getPendingPlanApprovalWire", SESSION_ID),
    "getPendingPlanApprovalWire"
  );
  return result.snapshot;
}

describe("Plan lifecycle decoupled from exec mode", () => {
  before(async () => {
    await waitForApp();
    unwrap(
      await invokeE2E("debugSeedPendingPlanWire", {
        sessionId: SESSION_ID,
        planPath: PLAN_PATH,
        planTitle: PLAN_TITLE,
        planContent: `# ${PLAN_TITLE}\n\nDo the thing.`,
      }),
      "seed pending plan"
    );
  });

  after(async () => {
    await invokeE2E("deleteSessionWire", SESSION_ID);
  });

  it("keeps the pending plan when the session switches from Plan to Build (ex-Chokepoint B)", async () => {
    const seeded = await pendingSnapshot();
    expect(seeded).not.toBeNull();
    expect(seeded.planTitle).toBe(PLAN_TITLE);

    unwrap(
      await invokeE2E("patchSessionExecModeWire", SESSION_ID, "build"),
      "switch exec mode to build"
    );

    // Pre-fix: this query returned null (row Abandoned by the patch) and —
    // worse — the query ITSELF used to Orphan the row (gate A6). Both
    // behaviors are dead; the row must survive arbitrarily many reads.
    const afterSwitch = await pendingSnapshot();
    expect(afterSwitch).not.toBeNull();
    expect(afterSwitch.planTitle).toBe(PLAN_TITLE);

    const secondRead = await pendingSnapshot();
    expect(secondRead).not.toBeNull();
  });

  it("keeps the pending plan across further mode flips (build → ask → build)", async () => {
    unwrap(
      await invokeE2E("patchSessionExecModeWire", SESSION_ID, "ask"),
      "switch exec mode to ask"
    );
    unwrap(
      await invokeE2E("patchSessionExecModeWire", SESSION_ID, "build"),
      "switch exec mode back to build"
    );

    const snapshot = await pendingSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot.planTitle).toBe(PLAN_TITLE);
  });

  it("resolves the plan cross-mode via Skip while the session is in Build mode", async () => {
    // Cross-mode resolution: the session sits in Build mode, yet the Skip
    // (reject) response must consume the pending plan normally.
    unwrap(
      await invokeE2E("respondPlanApprovalWire", SESSION_ID, "reject"),
      "reject plan from build mode"
    );

    const afterReject = await pendingSnapshot();
    expect(afterReject).toBeNull();
  });
});
