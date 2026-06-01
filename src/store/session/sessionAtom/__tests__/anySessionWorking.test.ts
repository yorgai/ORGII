/**
 * `anySessionWorkingAtom` invariants.
 *
 * This atom drives `useSleepInhibitor` — the decision to hold a platform
 * sleep-inhibitor lock turns on whether ANY session is in a "working" status.
 * If someone adds a new session status (or moves one between "active" and
 * "working" semantics), these tests catch the drift before the sleep
 * inhibitor silently regresses to "never engaged" or "always engaged".
 *
 * Working status (sleep-inhibitor on):
 *   running, installing, in_progress, pending, queued, waiting_for_funds
 * Not working (sleep-inhibitor off):
 *   idle, paused, waiting_for_user, completed, failed, cancelled, ...
 */
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import { anySessionWorkingAtom, sessionsAtom } from "../atoms";
import type { Session } from "../types";

function makeSession(id: string, status: string): Session {
  return {
    session_id: id,
    status,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("anySessionWorkingAtom", () => {
  it("returns false for an empty session list", () => {
    const store = createStore();
    store.set(sessionsAtom, []);
    expect(store.get(anySessionWorkingAtom)).toBe(false);
  });

  it.each([
    ["running"],
    ["installing"],
    ["in_progress"],
    ["pending"],
    ["queued"],
    ["waiting_for_funds"],
  ])("returns true when a session is %s", (status) => {
    const store = createStore();
    store.set(sessionsAtom, [makeSession("a", status)]);
    expect(store.get(anySessionWorkingAtom)).toBe(true);
  });

  it.each([
    ["idle"],
    ["paused"],
    ["waiting_for_user"],
    ["completed"],
    ["failed"],
    ["error"],
    ["cancelled"],
    ["abandoned"],
    ["timeout"],
    ["killed"],
  ])(
    "returns false when the only session is %s (not in-flight work)",
    (status) => {
      const store = createStore();
      store.set(sessionsAtom, [makeSession("a", status)]);
      expect(store.get(anySessionWorkingAtom)).toBe(false);
    }
  );

  it("returns true if at least one session is working among many idle ones", () => {
    const store = createStore();
    store.set(sessionsAtom, [
      makeSession("a", "idle"),
      makeSession("b", "completed"),
      makeSession("c", "running"),
      makeSession("d", "waiting_for_user"),
    ]);
    expect(store.get(anySessionWorkingAtom)).toBe(true);
  });

  it("reacts when the working session transitions to completed", () => {
    const store = createStore();
    store.set(sessionsAtom, [makeSession("a", "running")]);
    expect(store.get(anySessionWorkingAtom)).toBe(true);

    store.set(sessionsAtom, [
      {
        ...makeSession("a", "completed"),
        completed_at: "2026-01-01T00:01:00Z",
      },
    ]);
    expect(store.get(anySessionWorkingAtom)).toBe(false);
  });

  it("ignores unknown status strings (defaults to not working)", () => {
    const store = createStore();
    store.set(sessionsAtom, [makeSession("a", "some_future_status")]);
    expect(store.get(anySessionWorkingAtom)).toBe(false);
  });
});
