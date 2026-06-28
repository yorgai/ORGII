import { describe, expect, it } from "vitest";

import { TOOL_USAGE_ATTRIBUTION_METHOD } from "@src/api/tauri/session";
import {
  type SessionEvent,
  TOOL_USAGE_ARGS_KEY,
} from "@src/engines/SessionCore/core/types";

import {
  applyToolUsageToEvents,
  buildUsageMap,
  withToolUsageArgs,
} from "../toolUsageCache";

function makeEvent(callId?: string): SessionEvent {
  return {
    id: callId ? `tool-call-${callId}` : "message-1",
    chunk_id: null,
    sessionId: "session-1",
    createdAt: "2026-06-28T00:00:00.000Z",
    functionName: callId ? "read_file" : "assistant_message",
    uiCanonical: callId ? "read_file" : "assistant_message",
    actionType: callId ? "tool_call" : "assistant",
    args: { path: "README.md" },
    result: {},
    source: "assistant",
    displayText: "Read file",
    displayStatus: "completed",
    displayVariant: callId ? "tool_call" : "message",
    activityStatus: "agent",
    callId,
  };
}

describe("toolUsageCache", () => {
  it("aggregates attribution records by callId", () => {
    const usageByCallId = buildUsageMap(
      [
        {
          id: 1,
          sessionId: "session-1",
          turnId: "turn-1",
          eventId: "tool-call-call-1",
          toolCallId: "call-1",
          toolName: "read_file",
          iterationIndex: 1,
          decisionCompletionTokens: 10,
          resultContextTokens: 20,
          followupCompletionTokens: 0,
          inputBytes: 100,
          outputBytes: 200,
          attributionMethod:
            TOOL_USAGE_ATTRIBUTION_METHOD.SINGLE_TOOL_ITERATION,
          createdAt: "2026-06-28T00:00:00.000Z",
        },
        {
          id: 2,
          sessionId: "session-1",
          turnId: "turn-1",
          eventId: "tool-call-call-1",
          toolCallId: "call-1",
          toolName: "read_file",
          iterationIndex: 2,
          decisionCompletionTokens: 3,
          resultContextTokens: 5,
          followupCompletionTokens: 7,
          inputBytes: 11,
          outputBytes: 13,
          attributionMethod:
            TOOL_USAGE_ATTRIBUTION_METHOD.SINGLE_TOOL_ITERATION,
          createdAt: "2026-06-28T00:00:01.000Z",
        },
      ],
      [
        {
          id: 1,
          sessionId: "session-1",
          turnId: "turn-1",
          iterationIndex: 1,
          model: "model-1",
          accountId: "account-1",
          promptTokens: 100,
          completionTokens: 20,
          cacheReadTokens: 12,
          cacheWriteTokens: 5,
          totalTokens: 137,
          contextTokens: 117,
          relatedToolCallIdsJson: '["call-1"]',
          contextUsageJson: null,
          createdAt: "2026-06-28T00:00:00.000Z",
        },
      ]
    );

    const expected = {
      decisionCompletionTokens: 13,
      resultContextTokens: 25,
      followupCompletionTokens: 7,
      inputBytes: 111,
      outputBytes: 213,
      relatedCacheReadTokens: 12,
      relatedCacheWriteTokens: 5,
      attributionMethod: TOOL_USAGE_ATTRIBUTION_METHOD.SINGLE_TOOL_ITERATION,
    };
    expect(usageByCallId.get("call-1")).toEqual(expected);
    expect(usageByCallId.get("tool-call-call-1")).toEqual(expected);
  });

  it("attaches usage to matching events without fetching per block", () => {
    const toolUsage = {
      decisionCompletionTokens: 10,
      resultContextTokens: 25,
      followupCompletionTokens: 0,
      inputBytes: 100,
      outputBytes: 200,
      relatedCacheReadTokens: 0,
      relatedCacheWriteTokens: 0,
      attributionMethod: TOOL_USAGE_ATTRIBUTION_METHOD.BYTES_ONLY,
    };
    const events = [makeEvent("call-1"), makeEvent("call-2"), makeEvent()];
    const enriched = applyToolUsageToEvents(
      events,
      new Map([["call-1", toolUsage]])
    );

    expect(enriched[0].toolUsage).toEqual(toolUsage);
    expect(enriched[0].args[TOOL_USAGE_ARGS_KEY]).toEqual(toolUsage);
    expect(enriched[1].toolUsage).toBeUndefined();
    expect(enriched[2].toolUsage).toBeUndefined();
  });

  it("stores usage metadata in args patch payloads", () => {
    const usage = {
      decisionCompletionTokens: 1,
      resultContextTokens: 2,
      followupCompletionTokens: 3,
      inputBytes: 4,
      outputBytes: 5,
      relatedCacheReadTokens: 6,
      relatedCacheWriteTokens: 7,
      attributionMethod: TOOL_USAGE_ATTRIBUTION_METHOD.SPLIT_EVENLY,
    };

    expect(withToolUsageArgs({ existing: true }, usage)).toEqual({
      existing: true,
      [TOOL_USAGE_ARGS_KEY]: usage,
    });
  });
});
