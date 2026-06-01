/**
 * Streaming utilities.
 *
 * Maps @a2a-js/sdk stream events (Task, TaskStatusUpdateEvent,
 * TaskArtifactUpdateEvent, Message) into DelegationStreamEvent objects.
 */
import type {
  Message,
  Task,
  TaskArtifactUpdateEvent,
  TaskState,
  TaskStatusUpdateEvent,
} from "@a2a-js/sdk";

import type {
  DelegationResult,
  DelegationStatus,
  DelegationStreamEvent,
} from "./types.js";

type A2AStreamEvent =
  | Task
  | Message
  | TaskStatusUpdateEvent
  | TaskArtifactUpdateEvent;

const TASK_STATE_TO_DELEGATION_STATUS: Record<string, DelegationStatus> = {
  submitted: "pending",
  working: "in_progress",
  completed: "completed",
  failed: "failed",
  canceled: "cancelled",
  rejected: "failed",
  "input-required": "in_progress",
  "auth-required": "pending",
  unknown: "pending",
};

function mapTaskState(state: TaskState): DelegationStatus {
  return TASK_STATE_TO_DELEGATION_STATUS[state] ?? "pending";
}

function extractDataFromParts(
  parts: Array<{ kind: string; data?: Record<string, unknown>; text?: string }>
): Record<string, unknown> {
  for (const part of parts) {
    if (part.kind === "data" && part.data) {
      return part.data;
    }
  }
  for (const part of parts) {
    if (part.kind === "text" && part.text) {
      return { text: part.text };
    }
  }
  return {};
}

function buildResultFromTask(
  task: Task,
  agentAppId: string,
  skillId: string,
  startTime: number
): DelegationResult {
  const status = mapTaskState(task.status.state);
  const output = task.artifacts?.[0]?.parts
    ? extractDataFromParts(
        task.artifacts[0].parts as Array<{
          kind: string;
          data?: Record<string, unknown>;
          text?: string;
        }>
      )
    : undefined;
  const errorMessage =
    status === "failed"
      ? (
          task.status.message as
            | { parts?: Array<{ text?: string }> }
            | undefined
        )?.parts?.[0]?.text
      : undefined;
  const costUsd = (task.metadata?.["cost_usd"] as number) ?? 0;
  const confidence = (task.metadata?.["confidence"] as number) ?? undefined;

  return {
    taskId: task.id,
    agentAppId,
    skillId,
    status,
    output,
    error: errorMessage,
    costUsd,
    latencyMs: Date.now() - startTime,
    startedAt: new Date(startTime).toISOString(),
    completedAt:
      status === "completed" || status === "failed"
        ? new Date().toISOString()
        : undefined,
    confidence,
  };
}

/**
 * Converts an @a2a-js/sdk async stream into DelegationStreamEvent objects.
 */
export async function* mapA2AStreamToDelegationEvents(
  stream: AsyncGenerator<A2AStreamEvent, void, undefined>,
  agentAppId: string,
  skillId: string,
  startTime: number
): AsyncGenerator<DelegationStreamEvent, void, undefined> {
  for await (const event of stream) {
    const timestamp = new Date().toISOString();

    switch (event.kind) {
      case "task": {
        const task = event as Task;
        const status = mapTaskState(task.status.state);
        if (status === "completed" || status === "failed") {
          yield {
            kind: "complete",
            taskId: task.id,
            timestamp,
            result: buildResultFromTask(task, agentAppId, skillId, startTime),
          };
        } else {
          yield {
            kind: "status",
            taskId: task.id,
            timestamp,
            status,
          };
        }
        break;
      }

      case "status-update": {
        const statusEvent = event as TaskStatusUpdateEvent;
        const status = mapTaskState(statusEvent.status.state);

        if (
          statusEvent.final &&
          (status === "completed" || status === "failed")
        ) {
          yield {
            kind: status === "failed" ? "error" : "status",
            taskId: statusEvent.taskId,
            timestamp,
            ...(status === "failed"
              ? {
                  error:
                    (
                      statusEvent.status.message as
                        | { parts?: Array<{ text?: string }> }
                        | undefined
                    )?.parts?.[0]?.text ?? "Task failed",
                }
              : { status }),
          } as DelegationStreamEvent;
        } else {
          yield {
            kind: "status",
            taskId: statusEvent.taskId,
            timestamp,
            status,
            message: (
              statusEvent.status.message as
                | { parts?: Array<{ text?: string }> }
                | undefined
            )?.parts?.[0]?.text,
          };
        }
        break;
      }

      case "artifact-update": {
        const artifactEvent = event as TaskArtifactUpdateEvent;
        const parts = artifactEvent.artifact.parts as Array<{
          kind: string;
          data?: Record<string, unknown>;
          text?: string;
        }>;
        const data = extractDataFromParts(parts);

        yield {
          kind: "artifact",
          taskId: artifactEvent.taskId,
          timestamp,
          artifactId: artifactEvent.artifact.artifactId,
          data,
          isFinal: artifactEvent.lastChunk ?? false,
        };
        break;
      }

      case "message": {
        const msg = event as Message;
        const textPart = msg.parts?.find(
          (part): part is { kind: "text"; text: string } => part.kind === "text"
        );
        yield {
          kind: "status",
          taskId: msg.taskId ?? "unknown",
          timestamp,
          status: "in_progress",
          message: textPart?.text,
        };
        break;
      }

      default:
        break;
    }
  }
}

export { buildResultFromTask, mapTaskState, extractDataFromParts };
