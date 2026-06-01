import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../../core/types";
import {
  PLAN_EVENT_NAME,
  derivePlanApprovalViewState,
  derivePlanDisplayEvents,
  getPendingPlanAliases,
  getPlanEventAliases,
  isPlanApprovalEvent,
  isPlanDisplayEvent,
  pendingPlanMatchesEvent,
  shouldDefaultCollapsePlanCard,
  shouldRenderCurrentPlanSurface,
} from "../planDisplayEvents";

function event(overrides: Partial<SessionEvent>): SessionEvent {
  return {
    id: "event",
    chunk_id: null,
    sessionId: "session-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    functionName: "assistant_message",
    uiCanonical: "agent_message",
    actionType: "assistant",
    args: {},
    result: {},
    source: "assistant",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
    ...overrides,
  };
}

function rawCreatePlan(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return event({
    id: "raw-create-plan",
    functionName: PLAN_EVENT_NAME.CREATE_PLAN,
    uiCanonical: PLAN_EVENT_NAME.CREATE_PLAN,
    actionType: "tool_call",
    callId: "call_1",
    args: { title: "Plan", streamContent: "draft" },
    displayText: "Plan",
    displayStatus: "running",
    displayVariant: "tool_call",
    ...overrides,
  });
}

function planApproval(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return event({
    id: "call_1",
    functionName: PLAN_EVENT_NAME.PLAN_APPROVAL,
    uiCanonical: PLAN_EVENT_NAME.PLAN_APPROVAL,
    actionType: PLAN_EVENT_NAME.PLAN_APPROVAL,
    callId: "call_1",
    args: {
      title: "Plan",
      content: "final",
      planId: "plan-1",
      planRevisionId: "call_1",
      originToolCallId: "call_1",
    },
    result: {
      status: "pending",
      planId: "plan-1",
      planRevisionId: "call_1",
      planPath: "/tmp/plan.md",
    },
    displayText: "Plan",
    displayStatus: "awaiting_user",
    displayVariant: "tool_call",
    ...overrides,
  });
}

describe("plan display event derivation", () => {
  it("does not crash on plan events without result payloads", () => {
    const raw = rawCreatePlan({ result: undefined });

    expect(() => derivePlanDisplayEvents([raw])).not.toThrow();
    const derived = derivePlanDisplayEvents([raw]);

    expect(derived).toHaveLength(1);
    expect(derived[0].id).toBe(raw.id);
  });

  it("recognizes explicit plan approval lifecycle events", () => {
    const approval = planApproval();

    expect(isPlanApprovalEvent(approval)).toBe(true);
    expect(isPlanDisplayEvent(approval)).toBe(true);
  });

  it("coalesces running create_plan and explicit plan_approval without ID prefixes", () => {
    const raw = rawCreatePlan();
    const approval = planApproval({ createdAt: "2026-05-15T00:00:01.000Z" });

    const derived = derivePlanDisplayEvents([
      event({ id: "assistant-1", displayText: "hello" }),
      raw,
      approval,
    ]);

    expect(derived.map((item) => item.id)).toEqual(["assistant-1", "call_1"]);
    expect(derived[1].functionName).toBe(PLAN_EVENT_NAME.PLAN_APPROVAL);
    expect(derived[1].args.content).toBe("final");
  });

  it("keeps the streaming draft visible before approval exists", () => {
    const derived = derivePlanDisplayEvents([rawCreatePlan()]);

    expect(derived).toHaveLength(1);
    expect(derived[0].functionName).toBe(PLAN_EVENT_NAME.CREATE_PLAN);
    expect(derived[0].args.streamContent).toBe("draft");
  });

  it("treats submitted create_plan results as display events even when new_plan is false", () => {
    const submitted = rawCreatePlan({
      id: "tool-call-call_2",
      callId: "call_2",
      displayStatus: "completed",
      args: {
        title: "Updated plan",
        content: "# Updated plan",
      },
      result: {
        content:
          'PLAN_SUBMITTED_END_TURN:{"path":"/tmp/plan.md","slug":"updated-plan","hash":"pending","bytes_written":14,"new_plan":false,"submitted_for_review":true}',
      },
    });

    const derived = derivePlanDisplayEvents([submitted]);

    expect(derived).toHaveLength(1);
    expect(derived[0].id).toBe("tool-call-call_2");
    expect(isPlanDisplayEvent(derived[0])).toBe(true);
  });

  it("treats interactive create_plan tool calls as streaming drafts", () => {
    const derived = derivePlanDisplayEvents([
      rawCreatePlan({ displayStatus: "awaiting_user" }),
    ]);

    expect(derived).toHaveLength(1);
    expect(derived[0].functionName).toBe(PLAN_EVENT_NAME.CREATE_PLAN);
    expect(derived[0].args.streamContent).toBe("draft");
  });

  it("coalesces raw tool-call prefixed events with lifecycle plan revisions", () => {
    const raw = rawCreatePlan({
      id: "tool-call-call_1",
      callId: "call_1",
      createdAt: "2026-05-15T00:00:00.000Z",
    });
    const approval = planApproval({
      id: "call_1",
      callId: "call_1",
      createdAt: "2026-05-15T00:00:01.000Z",
    });

    const derived = derivePlanDisplayEvents([raw, approval]);

    expect(derived).toHaveLength(1);
    expect(derived[0].id).toBe("call_1");
    expect(derived[0].functionName).toBe(PLAN_EVENT_NAME.PLAN_APPROVAL);
  });
  it("anchors archived lifecycle updates to the original plan revision position", () => {
    const raw = rawCreatePlan({
      id: "tool-call-call_1",
      callId: "call_1",
      createdAt: "2026-05-15T00:00:00.000Z",
      args: {
        title: "Old plan",
        streamContent: "# Old plan",
        planId: "plan-1",
        planRevisionId: "call_1",
      },
      displayStatus: "completed",
    });
    const userFollowup = event({
      id: "user-2",
      source: "user",
      createdAt: "2026-05-15T00:00:01.000Z",
    });
    const secondApproval = planApproval({
      id: "call_2",
      callId: "call_2",
      args: {
        title: "New plan",
        content: "new",
        planId: "plan-1",
        planRevisionId: "call_2",
        originToolCallId: "call_2",
      },
      result: {
        status: "pending",
        planId: "plan-1",
        planRevisionId: "call_2",
        planPath: "/tmp/plan.md",
      },
      createdAt: "2026-05-15T00:00:02.000Z",
    });
    const archived = planApproval({
      id: "archived-call_1",
      callId: "call_1",
      args: {
        planId: "plan-1",
        planRevisionId: "call_1",
        originToolCallId: "call_1",
      },
      result: {
        status: "archived",
        planId: "plan-1",
        planRevisionId: "call_1",
      },
      createdAt: "2026-05-15T00:00:03.000Z",
    });

    const derived = derivePlanDisplayEvents([
      raw,
      userFollowup,
      secondApproval,
      archived,
    ]);

    expect(derived.map((item) => item.id)).toEqual([
      "archived-call_1",
      "user-2",
      "call_2",
    ]);
    expect(derived[0].createdAt).toBe("2026-05-15T00:00:00.000Z");
    expect(derived[0].args.title).toBe("Old plan");
    expect(derived[0].result.status).toBe("archived");
  });

  it("anchors archived approval-only revisions to their first pending position", () => {
    const pending = planApproval({
      id: "call_1",
      callId: "call_1",
      createdAt: "2026-05-15T00:00:00.000Z",
    });
    const userFollowup = event({
      id: "user-2",
      source: "user",
      createdAt: "2026-05-15T00:00:01.000Z",
    });
    const archived = planApproval({
      id: "call_1-archived",
      callId: "call_1",
      args: {
        title: "Plan",
        content: "final",
        planId: "plan-1",
        planRevisionId: "call_1",
        originToolCallId: "call_1",
      },
      result: {
        status: "archived",
        planId: "plan-1",
        planRevisionId: "call_1",
        planPath: "/tmp/plan.md",
      },
      displayStatus: "completed",
      createdAt: "2026-05-15T00:00:02.000Z",
    });

    const derived = derivePlanDisplayEvents([pending, userFollowup, archived]);

    expect(derived.map((item) => item.id)).toEqual([
      "call_1-archived",
      "user-2",
    ]);
    expect(derived[0].createdAt).toBe("2026-05-15T00:00:00.000Z");
    expect(derived[0].result.status).toBe("archived");
  });

  it("prefers terminal skipped status over the original pending plan event", () => {
    const pending = planApproval({
      id: "call_1",
      createdAt: "2026-05-15T00:00:00.000Z",
    });
    const cancelled = planApproval({
      id: "call_1-cancelled",
      callId: "call_1",
      args: {
        title: "Plan",
        content: "final",
        planId: "plan-1",
        planRevisionId: "call_1",
        originToolCallId: "call_1",
      },
      result: {
        status: "cancelled",
        planId: "plan-1",
        planRevisionId: "call_1",
        planPath: "/tmp/plan.md",
      },
      displayStatus: "completed",
      createdAt: "2026-05-15T00:00:01.000Z",
    });

    const derived = derivePlanDisplayEvents([pending, cancelled]);

    expect(derived).toHaveLength(1);
    expect(derived[0].id).toBe("call_1-cancelled");
    expect(derived[0].result.status).toBe("cancelled");
  });

  it("does not render rehydrated pending-plan snapshots in transcript history", () => {
    const rehydratedApproval = planApproval({
      id: "call_1",
      callId: "call_1",
      args: {
        title: "Sample Display Plan",
        content: "body",
        planId: "plan-1",
        planRevisionId: "call_1",
        originToolCallId: "call_1",
        planEventSource: "rehydrate",
      },
      result: {
        status: "pending",
        planId: "plan-1",
        planRevisionId: "call_1",
      },
      createdAt: "2026-05-15T00:00:02.000Z",
    });
    const followup = event({
      id: "assistant-after-rehydrate",
      createdAt: "2026-05-15T00:00:03.000Z",
      functionName: "assistant_message",
      uiCanonical: "agent_message",
    });

    expect(derivePlanDisplayEvents([rehydratedApproval, followup])).toEqual([
      followup,
    ]);
  });

  it("pins the current pending plan only after the user leaves the plan round", () => {
    const pendingPlan = {
      sessionId: "session-1",
      planPath: "/tmp/plan.md",
      planTitle: "Plan",
      planContent: "final",
      toolCallId: "call_1",
      planId: "plan-1",
      planRevisionId: "call_1",
      originToolCallId: "call_1",
    };
    const approval = planApproval({ createdAt: "2026-05-15T00:00:01.000Z" });
    const followup = event({
      id: "user-after-plan",
      createdAt: "2026-05-15T00:00:02.000Z",
      functionName: "user_message",
      uiCanonical: "user_message",
      source: "user",
    });

    expect(
      shouldRenderCurrentPlanSurface({
        currentPlanApproval: pendingPlan,
        chatEvents: [approval],
      })
    ).toBe(false);
    expect(
      shouldRenderCurrentPlanSurface({
        currentPlanApproval: pendingPlan,
        chatEvents: [approval, followup],
      })
    ).toBe(true);
  });

  it("keeps the current pending plan in transcript when a raw create_plan call matches it", () => {
    const pendingPlan = {
      sessionId: "session-1",
      planPath: "/tmp/plan.md",
      planTitle: "Plan",
      planContent: "final",
      toolCallId: "call_1",
      planId: "plan-1",
      planRevisionId: "call_1",
      originToolCallId: "call_1",
    };
    const rawCall = rawCreatePlan({
      callId: "call_1",
      args: {
        title: "Plan",
        content: "final",
        planRevisionId: "call_1",
        originToolCallId: "call_1",
      },
      result: {
        planRevisionId: "call_1",
        originToolCallId: "call_1",
      },
      displayStatus: "completed",
    });

    expect(
      shouldRenderCurrentPlanSurface({
        currentPlanApproval: pendingPlan,
        chatEvents: [rawCall],
      })
    ).toBe(false);
  });

  it("keeps the current pending plan in transcript when the plan round already contains it", () => {
    const replacementPendingPlan = {
      sessionId: "session-1",
      planPath: "/tmp/plan.md",
      planTitle: "New plan",
      planContent: "new",
      toolCallId: "call_2",
      planId: "plan-1",
      planRevisionId: "call_2",
      originToolCallId: "call_2",
    };
    const oldApproval = planApproval({
      id: "call_1",
      callId: "call_1",
      args: {
        title: "Old plan",
        content: "old",
        planId: "plan-1",
        planRevisionId: "call_1",
        originToolCallId: "call_1",
      },
      result: {
        status: "pending",
        planId: "plan-1",
        planRevisionId: "call_1",
        planPath: "/tmp/plan.md",
      },
      createdAt: "2026-05-15T00:00:01.000Z",
    });
    const newApproval = planApproval({
      id: "call_2",
      callId: "call_2",
      args: {
        title: "New plan",
        content: "new",
        planId: "plan-1",
        planRevisionId: "call_2",
        originToolCallId: "call_2",
      },
      result: {
        status: "pending",
        planId: "plan-1",
        planRevisionId: "call_2",
        planPath: "/tmp/plan.md",
      },
      createdAt: "2026-05-15T00:00:02.000Z",
    });

    const viewState = derivePlanApprovalViewState({
      pendingPlan: replacementPendingPlan,
      chatEvents: [oldApproval, newApproval],
    });

    expect(viewState.currentSurfaceVisible).toBe(false);
    expect(viewState.getEventState(oldApproval, "transcript")).toMatchObject({
      status: "archived",
      stale: true,
      ownsActions: false,
      actionable: false,
    });
    expect(viewState.getEventState(newApproval, "transcript")).toMatchObject({
      status: "pending",
      readyForReview: true,
      ownsActions: true,
      actionable: true,
    });
    expect(viewState.getEventState(newApproval, "current")).toMatchObject({
      readyForReview: true,
      ownsActions: false,
      actionable: false,
    });
    expect(viewState.getEventState(newApproval, "communication")).toMatchObject(
      {
        readyForReview: true,
        ownsActions: false,
        actionable: false,
      }
    );
    expect(viewState.getEventState(newApproval, "preview")).toMatchObject({
      readyForReview: true,
      ownsActions: false,
      actionable: false,
    });
  });

  it("keeps old archived revisions visible as history while showing the new pending revision", () => {
    const firstApproval = planApproval({
      id: "call_1",
      callId: "call_1",
      args: {
        title: "Old plan",
        content: "old",
        planId: "plan-1",
        planRevisionId: "call_1",
        originToolCallId: "call_1",
      },
      result: {
        status: "archived",
        planId: "plan-1",
        planRevisionId: "call_1",
        planPath: "/tmp/plan.md",
      },
      createdAt: "2026-05-15T00:00:01.000Z",
    });
    const secondApproval = planApproval({
      id: "call_2",
      callId: "call_2",
      args: {
        title: "New plan",
        content: "new",
        planId: "plan-1",
        planRevisionId: "call_2",
        originToolCallId: "call_2",
      },
      result: {
        status: "pending",
        planId: "plan-1",
        planRevisionId: "call_2",
        planPath: "/tmp/plan.md",
      },
      createdAt: "2026-05-15T00:00:02.000Z",
    });

    const derived = derivePlanDisplayEvents([firstApproval, secondApproval]);

    expect(derived).toHaveLength(2);
    expect(derived.map((item) => item.id)).toEqual(["call_1", "call_2"]);
    expect(derived[0].result.status).toBe("archived");
    expect(derived[1].args.content).toBe("new");
  });

  it("normalizes aliases for prefixed tool-call ids across pending and event identity", () => {
    const pendingPlan = {
      sessionId: "session-1",
      planPath: "/tmp/plan.md",
      planTitle: "Plan",
      planContent: "final",
      toolCallId: "tool-call-call_1",
      planId: "plan-1",
      planRevisionId: "tool-call-call_1",
      originToolCallId: "tool-call-call_1",
    };
    const approval = planApproval({
      id: "call_1",
      callId: "call_1",
      args: {
        title: "Plan",
        content: "final",
        planId: "plan-1",
        planRevisionId: "call_1",
        originToolCallId: "call_1",
      },
    });

    expect(getPendingPlanAliases(pendingPlan)).toContain("call_1");
    expect(getPlanEventAliases(approval)).toContain("call_1");
    expect(pendingPlanMatchesEvent(pendingPlan, approval)).toBe(true);
  });

  it("derives transcript action ownership before side-chat and current ownership after side-chat", () => {
    const pendingPlan = {
      sessionId: "session-1",
      planPath: "/tmp/plan.md",
      planTitle: "Plan",
      planContent: "final",
      toolCallId: "call_1",
      planId: "plan-1",
      planRevisionId: "call_1",
      originToolCallId: "call_1",
    };
    const approval = planApproval({ createdAt: "2026-05-15T00:00:01.000Z" });
    const followup = event({
      id: "user-after-plan",
      createdAt: "2026-05-15T00:00:02.000Z",
      functionName: "user_message",
      uiCanonical: "user_message",
      source: "user",
    });

    const sameTurn = derivePlanApprovalViewState({
      pendingPlan,
      chatEvents: [approval],
    });
    expect(sameTurn.currentSurfaceVisible).toBe(false);
    expect(sameTurn.getEventState(approval, "transcript")).toMatchObject({
      readyForReview: true,
      ownsActions: true,
      actionable: true,
      label: "ready",
    });
    expect(sameTurn.getEventState(approval, "communication")).toMatchObject({
      readyForReview: true,
      ownsActions: false,
      actionable: false,
      label: "ready",
    });
    expect(sameTurn.getEventState(approval, "preview")).toMatchObject({
      readyForReview: true,
      ownsActions: false,
      actionable: false,
      label: "ready",
    });

    const afterSideChat = derivePlanApprovalViewState({
      pendingPlan,
      chatEvents: [approval, followup],
    });
    expect(afterSideChat.currentSurfaceVisible).toBe(true);
    expect(afterSideChat.getEventState(approval, "transcript")).toMatchObject({
      readyForReview: true,
      ownsActions: false,
      actionable: false,
    });
    expect(afterSideChat.getEventState(approval, "current")).toMatchObject({
      readyForReview: true,
      ownsActions: true,
      actionable: true,
    });
    expect(afterSideChat.getEventState(approval, "preview")).toMatchObject({
      readyForReview: true,
      ownsActions: true,
      actionable: true,
    });

    const nextPlanDraft = rawCreatePlan({
      id: "tool-call-call_2",
      callId: "call_2",
      createdAt: "2026-05-15T00:00:03.000Z",
    });
    const afterNewPlanStarts = derivePlanApprovalViewState({
      pendingPlan,
      chatEvents: [approval, followup, nextPlanDraft],
    });
    expect(afterNewPlanStarts.currentSurfaceVisible).toBe(false);
    expect(afterNewPlanStarts.getEventState(approval, "current")).toMatchObject(
      {
        ownsActions: false,
        actionable: false,
      }
    );
  });

  it("derives stale state for an old pending card after edit-resend replacement", () => {
    const replacementPendingPlan = {
      sessionId: "session-1",
      planPath: "/tmp/plan.md",
      planTitle: "New plan",
      planContent: "new",
      toolCallId: "call_2",
      planId: "plan-1",
      planRevisionId: "call_2",
      originToolCallId: "call_2",
    };
    const oldApproval = planApproval({
      id: "call_1",
      callId: "call_1",
      args: {
        title: "Old plan",
        content: "old",
        planId: "plan-1",
        planRevisionId: "call_1",
        originToolCallId: "call_1",
      },
      result: {
        status: "pending",
        planId: "plan-1",
        planRevisionId: "call_1",
      },
    });
    const newApproval = planApproval({
      id: "call_2",
      callId: "call_2",
      args: {
        title: "New plan",
        content: "new",
        planId: "plan-1",
        planRevisionId: "call_2",
        originToolCallId: "call_2",
      },
      result: {
        status: "pending",
        planId: "plan-1",
        planRevisionId: "call_2",
      },
      createdAt: "2026-05-15T00:00:02.000Z",
    });

    const viewState = derivePlanApprovalViewState({
      pendingPlan: replacementPendingPlan,
      chatEvents: [oldApproval, newApproval],
    });

    expect(viewState.getEventState(oldApproval, "transcript")).toMatchObject({
      status: "archived",
      readyForReview: false,
      ownsActions: false,
      actionable: false,
      stale: true,
      label: "archived",
    });
    expect(viewState.currentSurfaceVisible).toBe(false);
    expect(viewState.getEventState(newApproval, "transcript")).toMatchObject({
      status: "pending",
      readyForReview: true,
      ownsActions: true,
      actionable: true,
      stale: false,
      label: "ready",
    });
    expect(viewState.getEventState(newApproval, "current")).toMatchObject({
      readyForReview: true,
      ownsActions: false,
      actionable: false,
      stale: false,
      label: "ready",
    });
    expect(viewState.getEventState(newApproval, "preview")).toMatchObject({
      readyForReview: true,
      ownsActions: false,
      actionable: false,
      stale: false,
      label: "ready",
    });
  });

  it("archives any older pending plan when a newer pending revision becomes current", () => {
    const currentPendingPlan = {
      sessionId: "session-1",
      planPath: "/tmp/english-plan.md",
      planTitle: "English plan",
      planContent: "new",
      toolCallId: "call_2",
      planId: "plan-2",
      planRevisionId: "call_2",
      originToolCallId: "call_2",
    };
    const oldApproval = planApproval({
      id: "call_1",
      callId: "call_1",
      args: {
        title: "Original plan",
        content: "old",
        planId: "plan-1",
        planRevisionId: "call_1",
        originToolCallId: "call_1",
      },
      result: {
        status: "pending",
        planId: "plan-1",
        planRevisionId: "call_1",
        planPath: "/tmp/original-plan.md",
      },
      createdAt: "2026-05-15T00:00:01.000Z",
    });
    const newApproval = planApproval({
      id: "call_2",
      callId: "call_2",
      args: {
        title: "English plan",
        content: "new",
        planId: "plan-2",
        planRevisionId: "call_2",
        originToolCallId: "call_2",
      },
      result: {
        status: "pending",
        planId: "plan-2",
        planRevisionId: "call_2",
        planPath: "/tmp/english-plan.md",
      },
      createdAt: "2026-05-15T00:00:02.000Z",
    });

    const viewState = derivePlanApprovalViewState({
      pendingPlan: currentPendingPlan,
      chatEvents: [oldApproval, newApproval],
    });

    expect(viewState.getEventState(oldApproval, "transcript")).toMatchObject({
      status: "archived",
      readyForReview: false,
      ownsActions: false,
      actionable: false,
      stale: true,
      label: "archived",
    });
    expect(viewState.getEventState(newApproval, "transcript")).toMatchObject({
      status: "pending",
      readyForReview: true,
      ownsActions: true,
      actionable: true,
      stale: false,
      label: "ready",
    });
  });

  it("keeps approved build history non-actionable even when file snapshot undo redo happens later", () => {
    const approvedPlan = planApproval({
      result: {
        status: "approved",
        planId: "plan-1",
        planRevisionId: "call_1",
      },
    });
    const undoEvent = event({
      id: "undo-all",
      functionName: "undo_all",
      uiCanonical: "undo_all",
      actionType: "tool_call",
      createdAt: "2026-05-15T00:00:02.000Z",
    });
    const redoEvent = event({
      id: "redo-all",
      functionName: "redo_all",
      uiCanonical: "redo_all",
      actionType: "tool_call",
      createdAt: "2026-05-15T00:00:03.000Z",
    });

    const viewState = derivePlanApprovalViewState({
      pendingPlan: null,
      chatEvents: [approvedPlan, undoEvent, redoEvent],
    });

    expect(viewState.getEventState(approvedPlan, "transcript")).toMatchObject({
      status: "approved",
      readyForReview: false,
      ownsActions: false,
      actionable: false,
      label: "built",
    });
    expect(viewState.currentSurfaceVisible).toBe(false);
  });

  it("defaults completed transcript plan cards open while current composer cards stay collapsed", () => {
    expect(
      shouldDefaultCollapsePlanCard({
        surface: "transcript",
        isStreaming: false,
      })
    ).toBe(false);
    expect(
      shouldDefaultCollapsePlanCard({ surface: "current", isStreaming: false })
    ).toBe(true);
    expect(
      shouldDefaultCollapsePlanCard({
        surface: "transcript",
        isStreaming: true,
      })
    ).toBe(false);
  });
});
