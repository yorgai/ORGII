/**
 * Config Factory Tests
 *
 * Tests for defineSimulatorAppConfig and helper functions.
 */
import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { AppType } from "@src/engines/Simulator/types/appTypes";

import {
  defineSimulatorAppConfig,
  deriveOperationState,
} from "../configFactory";
import type { SimulatorAppBaseState } from "../types";

// ============================================
// Test Helpers
// ============================================

function createMockEvent(
  id: string,
  functionName: string,
  createdAt: string = new Date().toISOString()
): SessionEvent {
  return {
    id,
    functionName,
    sessionId: "test-session",
    createdAt,
    args: {},
    result: {},
    source: "agent",
    displayStatus: "completed",
  } as unknown as SessionEvent;
}

// ============================================
// defineSimulatorAppConfig Tests
// ============================================

describe("defineSimulatorAppConfig", () => {
  interface TestState extends SimulatorAppBaseState {
    items: string[];
    selectedItem: string | null;
  }

  it("creates config with correct properties", () => {
    const config = defineSimulatorAppConfig<TestState>({
      appType: AppType.CODE_EDITOR,
      name: "Test App",
      icon: "Code",
      deriveState: () => ({ items: [], selectedItem: null }),
    });

    expect(config.id).toBe(AppType.CODE_EDITOR);
    expect(config.name).toBe("Test App");
    expect(config.icon).toBe("Code");
    expect(typeof config.matchesEvent).toBe("function");
    expect(typeof config.deriveState).toBe("function");
  });

  it("deriveState is called correctly", () => {
    const mockEvents = [
      createMockEvent("1", "read_file"),
      createMockEvent("2", "write_file"),
    ];

    const deriveState = (
      events: SessionEvent[],
      currentEventId: string | null
    ) => ({
      items: events.map((e) => e.id),
      selectedItem: currentEventId,
    });

    const config = defineSimulatorAppConfig<TestState>({
      appType: AppType.CODE_EDITOR,
      name: "Test App",
      icon: "Code",
      deriveState,
    });

    const state = config.deriveState(mockEvents, "2");

    expect(state.items).toEqual(["1", "2"]);
    expect(state.selectedItem).toBe("2");
  });
});

// ============================================
// deriveOperationState Tests
// ============================================

describe("deriveOperationState", () => {
  interface TestOperation {
    eventId: string;
    name: string;
  }

  const extractOp = (
    event: SessionEvent,
    _isCurrent: boolean
  ): TestOperation | null => {
    if (!event.functionName.startsWith("test_")) return null;
    return {
      eventId: event.id,
      name: event.functionName,
    };
  };

  it("extracts operations from events", () => {
    const events = [
      createMockEvent("1", "test_op1"),
      createMockEvent("2", "test_op2"),
      createMockEvent("3", "other_op"), // Should be filtered out
    ];

    const result = deriveOperationState(events, null, extractOp);

    expect(result.operations).toHaveLength(2);
    expect(result.operations[0].eventId).toBe("1");
    expect(result.operations[1].eventId).toBe("2");
  });

  it("finds selected operation by currentEventId", () => {
    const events = [
      createMockEvent("1", "test_op1"),
      createMockEvent("2", "test_op2"),
    ];

    const result = deriveOperationState(events, "1", extractOp);

    expect(result.selectedOperation?.eventId).toBe("1");
  });

  it("falls back to last operation when currentEventId not found", () => {
    const events = [
      createMockEvent("1", "test_op1"),
      createMockEvent("2", "test_op2"),
    ];

    const result = deriveOperationState(events, "non-existent", extractOp);

    expect(result.selectedOperation?.eventId).toBe("2");
  });

  it("returns null selectedOperation for empty events", () => {
    const result = deriveOperationState([], null, extractOp);

    expect(result.operations).toHaveLength(0);
    expect(result.selectedOperation).toBeNull();
  });

  it("passes isCurrent flag correctly", () => {
    const events = [
      createMockEvent("1", "test_op1"),
      createMockEvent("2", "test_op2"),
    ];

    const capturedIsCurrent: boolean[] = [];
    const capturingExtractor = (
      event: SessionEvent,
      isCurrent: boolean
    ): TestOperation | null => {
      capturedIsCurrent.push(isCurrent);
      return { eventId: event.id, name: event.functionName };
    };

    deriveOperationState(events, "2", capturingExtractor);

    expect(capturedIsCurrent).toEqual([false, true]);
  });
});
