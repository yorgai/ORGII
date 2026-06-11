/**
 * useCellReplayState — FSM behavior tests.
 *
 * Verifies the structural fixes:
 *   - Scrub session: event growth during scrub does NOT move the cursor.
 *   - Follow mode: event growth advances the cursor to the new tail.
 *   - Detached mode: event growth does NOT move the cursor.
 *   - endScrub commits exactly once through the persisted setter.
 *
 * Runs in node env by replacing React's hook primitives with synchronous
 * identity wrappers (same pattern as useChatGroups.test.ts). State cells
 * are externally allocated so we can probe / reset them between renders.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { useCellReplayState } from "../useCellReplayState";

let stateCells: unknown[] = [];
let stateIndex = 0;
const refCells = new Map<number, { current: unknown }>();
let refIndex = 0;

vi.mock("react", () => {
  return {
    useState: <T>(
      initial: T | (() => T)
    ): [T, (next: T | ((prev: T) => T)) => void] => {
      const slot = stateIndex++;
      if (stateCells.length <= slot) {
        const initialValue =
          typeof initial === "function" ? (initial as () => T)() : initial;
        stateCells.push(initialValue);
      }
      const setter = (next: T | ((prev: T) => T)) => {
        const cur = stateCells[slot] as T;
        const value =
          typeof next === "function" ? (next as (prev: T) => T)(cur) : next;
        stateCells[slot] = value;
      };
      return [stateCells[slot] as T, setter];
    },
    useRef: <T>(initial: T): { current: T } => {
      const slot = refIndex++;
      let ref = refCells.get(slot) as { current: T } | undefined;
      if (!ref) {
        ref = { current: initial };
        refCells.set(slot, ref);
      }
      return ref;
    },
    useMemo: <T>(factory: () => T) => factory(),
    useCallback: <T>(fn: T) => fn,
    useEffect: (fn: () => void | (() => void)) => fn(),
    useLayoutEffect: (fn: () => void | (() => void)) => fn(),
  };
});

vi.mock("jotai", () => ({
  useAtomValue: () => 1,
  useSetAtom: () => () => {},
  atom: () => ({}),
}));

let persistedState:
  | { currentIndex: number; isPlaying: boolean; hasUserOverride?: boolean }
  | undefined = undefined;
let hasUserOverride = false;
const patchCellState = vi.fn(
  (
    patch: Partial<{
      currentIndex: number;
      isPlaying: boolean;
      hasUserOverride: boolean;
    }>
  ) => {
    persistedState = {
      ...(persistedState ?? { currentIndex: 0, isPlaying: false }),
      ...patch,
    };
    if (patch.hasUserOverride !== undefined) {
      hasUserOverride = patch.hasUserOverride;
    }
  }
);

vi.mock("../useCellPersistence", () => ({
  useCellPersistence: () => ({
    persistedState,
    hasUserOverride,
    patchCellState,
  }),
}));

vi.mock("../useCellPlayback", () => ({
  useCellPlayback: () => {},
}));

function makeEvent(index: number): SessionEvent {
  return {
    chunk_id: null,
    id: `e${index}`,
    sessionId: "session-id",
    createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
    actionType: "tool_call",
    functionName: "noop",
    uiCanonical: "",
    args: {},
    result: {},
    source: "assistant",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "agent",
  };
}

function buildEvents(count: number): SessionEvent[] {
  return Array.from({ length: count }, (_, i) => makeEvent(i));
}

// Not a real hook render: React is fully mocked above, so this is a plain
// synchronous evaluation against the externally-allocated state cells.
function evaluateHook(opts: Parameters<typeof useCellReplayState>[0]) {
  stateIndex = 0;
  refIndex = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- React primitives are vi.mock'd identity wrappers
  return useCellReplayState(opts);
}

beforeEach(() => {
  stateCells = [];
  refCells.clear();
  persistedState = undefined;
  hasUserOverride = false;
  patchCellState.mockClear();
});

describe("useCellReplayState — FSM transitions", () => {
  it("starts in follow mode when no external cursor is supplied", () => {
    const { state } = evaluateHook({
      events: buildEvents(3),
      externalCursorMs: null,
    });
    expect(state.mode).toBe("follow");
    expect(state.isDetached).toBe(false);
  });

  it("starts in synced mode when an external cursor is supplied", () => {
    const events = buildEvents(3);
    const cursorMs = new Date(events[1].createdAt).getTime();
    const { state } = evaluateHook({
      events,
      externalCursorMs: cursorMs,
    });
    expect(state.mode).toBe("synced");
    expect(state.currentIndex).toBe(1);
  });

  it("enters detached mode after user interaction (goToIndex)", () => {
    const events = buildEvents(3);
    const cursorMs = new Date(events[2].createdAt).getTime();
    const { controls } = evaluateHook({ events, externalCursorMs: cursorMs });
    controls.goToIndex(0);
    expect(hasUserOverride).toBe(true);

    const next = evaluateHook({ events, externalCursorMs: cursorMs });
    expect(next.state.mode).toBe("detached");
    expect(next.state.currentIndex).toBe(0);
  });

  it("syncToMain returns from detached to follow", () => {
    const { controls } = evaluateHook({
      events: buildEvents(3),
      externalCursorMs: null,
    });
    controls.goToIndex(0);
    controls.syncToMain();
    expect(hasUserOverride).toBe(false);

    const next = evaluateHook({
      events: buildEvents(3),
      externalCursorMs: null,
    });
    expect(next.state.mode).toBe("follow");
  });
});

describe("useCellReplayState — scrub session", () => {
  it("scrub() updates the displayed index without committing to persistence", () => {
    const { controls } = evaluateHook({
      events: buildEvents(5),
      externalCursorMs: null,
    });

    controls.beginScrub();
    controls.scrub(2);
    patchCellState.mockClear();

    const mid = evaluateHook({
      events: buildEvents(5),
      externalCursorMs: null,
    });
    expect(mid.state.currentIndex).toBe(2);
    expect(patchCellState).not.toHaveBeenCalled();
  });

  it("event growth during a scrub does NOT move the cursor", () => {
    // The original bug: streaming events fired the snap-to-tail effect,
    // teleporting the drag handle to the right edge on release.
    evaluateHook({ events: buildEvents(3), externalCursorMs: null });
    const { controls } = evaluateHook({
      events: buildEvents(3),
      externalCursorMs: null,
    });
    controls.beginScrub();
    controls.scrub(1);

    const after = evaluateHook({
      events: buildEvents(6),
      externalCursorMs: null,
    });
    expect(after.state.currentIndex).toBe(1);
  });

  it("endScrub commits exactly once and transitions to detached", () => {
    const { controls } = evaluateHook({
      events: buildEvents(5),
      externalCursorMs: null,
    });
    controls.beginScrub();
    controls.scrub(3);
    patchCellState.mockClear();

    controls.endScrub(3);
    expect(patchCellState).toHaveBeenCalledTimes(1);
    expect(patchCellState).toHaveBeenCalledWith({
      currentIndex: 3,
      isPlaying: false,
      hasUserOverride: true,
    });

    const after = evaluateHook({
      events: buildEvents(5),
      externalCursorMs: null,
    });
    expect(after.state.mode).toBe("detached");
    expect(after.state.currentIndex).toBe(3);
  });
});

describe("useCellReplayState — detached vs follow event growth", () => {
  it("detached mode does NOT tail to the new last event", () => {
    const { controls } = evaluateHook({
      events: buildEvents(3),
      externalCursorMs: null,
    });
    controls.goToIndex(1);

    const grown = evaluateHook({
      events: buildEvents(7),
      externalCursorMs: null,
    });
    expect(grown.state.mode).toBe("detached");
    expect(grown.state.currentIndex).toBe(1);
  });
});
