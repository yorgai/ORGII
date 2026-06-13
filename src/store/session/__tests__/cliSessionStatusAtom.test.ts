/**
 * Session-gated runtime-status setter tests.
 *
 * The gate atoms are registered by viewAtom.ts at module load; here we
 * register test-local atoms directly so the suite does not depend on the
 * viewAtom module graph (which needs localStorage + instrumented store).
 */
import { atom, createStore } from "jotai/vanilla";
import { afterEach, describe, expect, it } from "vitest";

import {
  registerRuntimeStatusGateSessionAtoms,
  sessionRuntimeStatusAtom,
  setSessionRuntimeStatusAtom,
} from "../cliSessionStatusAtom";

const visibleA = atom<string | null>(null);
const visibleB = atom<string | null>(null);

afterEach(() => {
  // Fail-open default so other suites importing this module are unaffected.
  registerRuntimeStatusGateSessionAtoms([]);
});

describe("setSessionRuntimeStatusAtom session gate", () => {
  it("applies writes for the visible session", () => {
    const store = createStore();
    registerRuntimeStatusGateSessionAtoms([visibleA, visibleB]);
    store.set(visibleA, "session-1");

    store.set(setSessionRuntimeStatusAtom, {
      sessionId: "session-1",
      status: "running",
      source: "dispatch",
    });

    expect(store.get(sessionRuntimeStatusAtom)).toBe("running");
  });

  it("drops writes for a non-visible session", () => {
    const store = createStore();
    registerRuntimeStatusGateSessionAtoms([visibleA, visibleB]);
    store.set(visibleA, "session-1");

    store.set(setSessionRuntimeStatusAtom, {
      sessionId: "session-2",
      status: "running",
      source: "queue",
    });

    expect(store.get(sessionRuntimeStatusAtom)).toBe("idle");
  });

  it("accepts a match on any registered gate atom", () => {
    const store = createStore();
    registerRuntimeStatusGateSessionAtoms([visibleA, visibleB]);
    store.set(visibleA, "session-1");
    store.set(visibleB, "session-2");

    store.set(setSessionRuntimeStatusAtom, {
      sessionId: "session-2",
      status: "running",
      source: "sync",
    });

    expect(store.get(sessionRuntimeStatusAtom)).toBe("running");
  });

  it("fails open before any gate atoms are registered", () => {
    const store = createStore();
    registerRuntimeStatusGateSessionAtoms([]);

    store.set(setSessionRuntimeStatusAtom, {
      sessionId: "session-anything",
      status: "completed",
      source: "planning",
    });

    expect(store.get(sessionRuntimeStatusAtom)).toBe("completed");
  });
});
