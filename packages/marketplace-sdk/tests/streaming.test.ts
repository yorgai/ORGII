import type {
  Message,
  Task,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
} from "@a2a-js/sdk";
import { describe, expect, it } from "vitest";

import {
  buildResultFromTask,
  extractDataFromParts,
  mapA2AStreamToDelegationEvents,
  mapTaskState,
} from "../src/streaming.js";

describe("mapTaskState", () => {
  it("maps 'submitted' to 'pending'", () => {
    expect(mapTaskState("submitted")).toBe("pending");
  });

  it("maps 'working' to 'in_progress'", () => {
    expect(mapTaskState("working")).toBe("in_progress");
  });

  it("maps 'completed' to 'completed'", () => {
    expect(mapTaskState("completed")).toBe("completed");
  });

  it("maps 'failed' to 'failed'", () => {
    expect(mapTaskState("failed")).toBe("failed");
  });

  it("maps 'canceled' to 'cancelled'", () => {
    expect(mapTaskState("canceled")).toBe("cancelled");
  });

  it("maps unknown states to 'pending'", () => {
    expect(mapTaskState("unknown")).toBe("pending");
  });
});

describe("extractDataFromParts", () => {
  it("extracts data from a DataPart", () => {
    const parts = [{ kind: "data", data: { foo: "bar" } }];
    expect(extractDataFromParts(parts)).toEqual({ foo: "bar" });
  });

  it("extracts text as data when no DataPart", () => {
    const parts = [{ kind: "text", text: "hello" }];
    expect(extractDataFromParts(parts)).toEqual({ text: "hello" });
  });

  it("prefers DataPart over TextPart", () => {
    const parts = [
      { kind: "text", text: "hello" },
      { kind: "data", data: { key: "value" } },
    ];
    expect(extractDataFromParts(parts)).toEqual({ key: "value" });
  });

  it("returns empty object for empty parts", () => {
    expect(extractDataFromParts([])).toEqual({});
  });
});

describe("buildResultFromTask", () => {
  it("builds a completed result with output", () => {
    const task: Task = {
      kind: "task",
      id: "task-1",
      contextId: "ctx-1",
      status: { state: "completed" },
      artifacts: [
        {
          artifactId: "art-1",
          parts: [{ kind: "data", data: { result: "ok" } }],
        },
      ],
      metadata: { cost_usd: 0.005, confidence: 0.95 },
    };

    const result = buildResultFromTask(
      task,
      "app-1",
      "skill-1",
      Date.now() - 100
    );
    expect(result.taskId).toBe("task-1");
    expect(result.agentAppId).toBe("app-1");
    expect(result.skillId).toBe("skill-1");
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ result: "ok" });
    expect(result.costUsd).toBe(0.005);
    expect(result.confidence).toBe(0.95);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.completedAt).toBeDefined();
  });

  it("builds a failed result with error message", () => {
    const task: Task = {
      kind: "task",
      id: "task-2",
      contextId: "ctx-2",
      status: {
        state: "failed",
        message: {
          kind: "message",
          messageId: "msg-1",
          role: "agent",
          parts: [{ kind: "text", text: "Something went wrong" }],
        },
      },
    };

    const result = buildResultFromTask(task, "app-1", "skill-1", Date.now());
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Something went wrong");
  });
});

describe("mapA2AStreamToDelegationEvents", () => {
  async function collectEvents(
    events: Array<
      Task | Message | TaskStatusUpdateEvent | TaskArtifactUpdateEvent
    >
  ) {
    async function* makeStream() {
      for (const event of events) {
        yield event;
      }
    }

    const collected = [];
    for await (const delegationEvent of mapA2AStreamToDelegationEvents(
      makeStream(),
      "app-1",
      "skill-1",
      Date.now()
    )) {
      collected.push(delegationEvent);
    }
    return collected;
  }

  it("maps a completed task to a complete event", async () => {
    const events = await collectEvents([
      {
        kind: "task",
        id: "task-1",
        contextId: "ctx-1",
        status: { state: "completed" },
        artifacts: [
          {
            artifactId: "art-1",
            parts: [{ kind: "data", data: { answer: 42 } }],
          },
        ],
      } as Task,
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("complete");
  });

  it("maps a working task to a status event", async () => {
    const events = await collectEvents([
      {
        kind: "task",
        id: "task-1",
        contextId: "ctx-1",
        status: { state: "working" },
      } as Task,
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("status");
    if (events[0].kind === "status") {
      expect(events[0].status).toBe("in_progress");
    }
  });

  it("maps status-update events", async () => {
    const events = await collectEvents([
      {
        kind: "status-update",
        taskId: "task-1",
        contextId: "ctx-1",
        status: { state: "working" },
        final: false,
      } as TaskStatusUpdateEvent,
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("status");
  });

  it("maps artifact-update events", async () => {
    const events = await collectEvents([
      {
        kind: "artifact-update",
        taskId: "task-1",
        contextId: "ctx-1",
        artifact: {
          artifactId: "art-1",
          parts: [{ kind: "data", data: { chunk: 1 } }],
        },
        append: true,
        lastChunk: false,
      } as TaskArtifactUpdateEvent,
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("artifact");
    if (events[0].kind === "artifact") {
      expect(events[0].data).toEqual({ chunk: 1 });
      expect(events[0].isFinal).toBe(false);
    }
  });

  it("maps a final failed status-update to an error event", async () => {
    const events = await collectEvents([
      {
        kind: "status-update",
        taskId: "task-1",
        contextId: "ctx-1",
        status: {
          state: "failed",
          message: {
            kind: "message",
            messageId: "msg-1",
            role: "agent",
            parts: [{ kind: "text", text: "Timeout" }],
          },
        },
        final: true,
      } as TaskStatusUpdateEvent,
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("error");
    if (events[0].kind === "error") {
      expect(events[0].error).toBe("Timeout");
    }
  });

  it("handles multiple events in sequence", async () => {
    const events = await collectEvents([
      {
        kind: "status-update",
        taskId: "task-1",
        contextId: "ctx-1",
        status: { state: "working" },
        final: false,
      } as TaskStatusUpdateEvent,
      {
        kind: "artifact-update",
        taskId: "task-1",
        contextId: "ctx-1",
        artifact: {
          artifactId: "art-1",
          parts: [{ kind: "data", data: { progress: 50 } }],
        },
        append: true,
        lastChunk: false,
      } as TaskArtifactUpdateEvent,
      {
        kind: "task",
        id: "task-1",
        contextId: "ctx-1",
        status: { state: "completed" },
        artifacts: [
          {
            artifactId: "art-1",
            parts: [{ kind: "data", data: { result: "done" } }],
          },
        ],
      } as Task,
    ]);

    expect(events).toHaveLength(3);
    expect(events[0].kind).toBe("status");
    expect(events[1].kind).toBe("artifact");
    expect(events[2].kind).toBe("complete");
  });
});
