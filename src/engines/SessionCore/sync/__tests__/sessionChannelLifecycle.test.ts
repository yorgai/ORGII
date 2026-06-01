/**
 * Unit tests for {@link SessionChannelLifecycle} — the state
 * machine that drives `useSessionChannel`'s Tauri subscribe /
 * unsubscribe / drop-late-events sequence.
 *
 * Coverage:
 *   - `start()` invokes the subscribe driver exactly once even when
 *     called repeatedly.
 *   - `start()` failure path: warn fires (when not yet destroyed),
 *     promise resolves to null, no unsubscribe attempted on dispose.
 *   - `onMessage()` forwards to the consumer when active, drops
 *     after dispose. Validation failures are warned and dropped.
 *   - `dispose()` chains the unsubscribe onto the in-flight subscribe
 *     promise; subscribe-before-dispose and dispose-before-subscribe
 *     both produce the same backend interaction.
 *   - `dispose()` is idempotent and warns on unsubscribe failure.
 *   - The destroyed flag suppresses post-dispose subscribe warnings
 *     (the rejection is "expected" when we already gave up).
 *   - Cross-session ordering: rapid A→B→A simulated, no events from
 *     the first A reach the second A's consumer.
 *
 * The lifecycle is intentionally framework-agnostic so we can drive
 * it from plain TypeScript without `jsdom` or `@testing-library`.
 */
import { describe, expect, it, vi } from "vitest";

import {
  type SessionChannelDrivers,
  SessionChannelLifecycle,
} from "../useSessionChannel";

// Mock the schema validator so the test exercises the lifecycle's
// gating logic, not the real session-event schema. Tests that want
// to assert validation behaviour use the override `mockImplementation`
// inside their own setup.
vi.mock("@src/engines/SessionCore/core/schemas", () => ({
  parseRawSessionEvent: vi.fn().mockImplementation((raw: string) => {
    if (typeof raw !== "string" || !raw.startsWith("{")) {
      throw new Error("test-mock: invalid payload");
    }
    return JSON.parse(raw);
  }),
}));

/**
 * A controllable mock subscribe driver: returns a Promise that
 * tests can resolve / reject on demand. Helpful for simulating
 * "subscribe takes a long time".
 */
function makeControllableSubscribe() {
  let resolveFn: ((id: number) => void) | null = null;
  let rejectFn: ((err: unknown) => void) | null = null;
  const promise = new Promise<number>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return {
    subscribe: vi.fn().mockImplementation(() => promise),
    resolve: (id: number) => {
      if (resolveFn) resolveFn(id);
    },
    reject: (err: unknown) => {
      if (rejectFn) rejectFn(err);
    },
  };
}

function makeDrivers(
  overrides: Partial<SessionChannelDrivers> = {}
): SessionChannelDrivers {
  return {
    subscribe: vi.fn().mockResolvedValue(42),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn(),
    ...overrides,
  };
}

describe("SessionChannelLifecycle — start()", () => {
  it("invokes the subscribe driver and stores the assigned channel id", async () => {
    const drivers = makeDrivers();
    const onDelivered = vi.fn();
    const lifecycle = new SessionChannelLifecycle(
      "session-1",
      drivers,
      onDelivered
    );
    const result = await lifecycle.start();
    expect(drivers.subscribe).toHaveBeenCalledTimes(1);
    expect(result).toBe(42);
    expect(lifecycle.getChannelId()).toBe(42);
  });

  it("is idempotent: repeated start() returns the same in-flight promise", async () => {
    const drivers = makeDrivers();
    const lifecycle = new SessionChannelLifecycle(
      "s",
      drivers,
      () => undefined
    );
    const a = lifecycle.start();
    const b = lifecycle.start();
    const c = lifecycle.start();
    expect(a).toBe(b);
    expect(b).toBe(c);
    await a;
    expect(drivers.subscribe).toHaveBeenCalledTimes(1);
  });

  it("on subscribe rejection: warns once, resolves to null", async () => {
    const drivers = makeDrivers({
      subscribe: vi.fn().mockRejectedValue(new Error("kaboom")),
    });
    const lifecycle = new SessionChannelLifecycle(
      "s",
      drivers,
      () => undefined
    );
    const result = await lifecycle.start();
    expect(result).toBeNull();
    expect(drivers.warn).toHaveBeenCalledTimes(1);
    const msg =
      (drivers.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? "";
    expect(String(msg)).toContain("Failed to subscribe");
  });

  it("subscribe rejection AFTER dispose does not warn (already given up)", async () => {
    const controllable = makeControllableSubscribe();
    const drivers = makeDrivers({ subscribe: controllable.subscribe });
    const lifecycle = new SessionChannelLifecycle(
      "s",
      drivers,
      () => undefined
    );
    const startP = lifecycle.start();
    void lifecycle.dispose();
    controllable.reject(new Error("late rejection"));
    const result = await startP;
    expect(result).toBeNull();
    // Dispose was called BEFORE the rejection, so we should NOT
    // emit a "Failed to subscribe" warning — the failure is the
    // expected end-state of "we don't care anymore".
    const warnCalls = (drivers.warn as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      warnCalls.some((c) => String(c[0] ?? "").includes("Failed to subscribe"))
    ).toBe(false);
  });
});

describe("SessionChannelLifecycle — onMessage()", () => {
  it("forwards to the consumer when active and returns true", () => {
    const onDelivered = vi.fn();
    const lifecycle = new SessionChannelLifecycle(
      "s",
      makeDrivers(),
      onDelivered
    );
    // Use a payload that the real validator would accept; the test
    // doesn't depend on schema details, just on the delivery being
    // forwarded.
    const payload = JSON.stringify({
      session_id: "s",
      action_type: "noop",
      timestamp: "2025-01-01T00:00:00Z",
    });
    const result = lifecycle.onMessage(payload);
    expect(result).toBe(true);
    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onDelivered).toHaveBeenCalledWith(payload);
  });

  it("drops messages after dispose and returns false", async () => {
    const onDelivered = vi.fn();
    const lifecycle = new SessionChannelLifecycle(
      "s",
      makeDrivers(),
      onDelivered
    );
    await lifecycle.start();
    const payload = JSON.stringify({
      session_id: "s",
      action_type: "noop",
      timestamp: "2025-01-01T00:00:00Z",
    });
    expect(lifecycle.onMessage(payload)).toBe(true);
    void lifecycle.dispose();
    expect(lifecycle.onMessage(payload)).toBe(false);
    expect(onDelivered).toHaveBeenCalledTimes(1);
  });

  it("invalid payloads are dropped via warn and return false", () => {
    const drivers = makeDrivers();
    const onDelivered = vi.fn();
    const lifecycle = new SessionChannelLifecycle("s", drivers, onDelivered);
    // Invalid JSON triggers the parser → throws → caught → warn.
    const result = lifecycle.onMessage("{not valid json");
    expect(result).toBe(false);
    expect(onDelivered).not.toHaveBeenCalled();
    expect(drivers.warn).toHaveBeenCalledTimes(1);
    const msg =
      (drivers.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? "";
    expect(String(msg)).toContain("Dropped invalid event payload");
  });

  it("consumer throw is treated like a validation failure (still drops, still warns)", () => {
    const drivers = makeDrivers();
    const lifecycle = new SessionChannelLifecycle("s", drivers, () => {
      throw new Error("consumer bang");
    });
    const payload = JSON.stringify({
      session_id: "s",
      action_type: "noop",
      timestamp: "2025-01-01T00:00:00Z",
    });
    expect(lifecycle.onMessage(payload)).toBe(false);
    expect(drivers.warn).toHaveBeenCalledTimes(1);
  });
});

describe("SessionChannelLifecycle — dispose()", () => {
  it("triggers unsubscribe with the assigned channel id", async () => {
    const drivers = makeDrivers();
    const lifecycle = new SessionChannelLifecycle(
      "s",
      drivers,
      () => undefined
    );
    await lifecycle.start();
    await lifecycle.dispose();
    expect(drivers.unsubscribe).toHaveBeenCalledTimes(1);
    expect(drivers.unsubscribe).toHaveBeenCalledWith(42);
  });

  it("is a no-op when never started (no subscribePromise to chain on)", async () => {
    const drivers = makeDrivers();
    const lifecycle = new SessionChannelLifecycle(
      "s",
      drivers,
      () => undefined
    );
    await lifecycle.dispose();
    expect(drivers.unsubscribe).not.toHaveBeenCalled();
    expect(lifecycle.isDestroyed()).toBe(true);
  });

  it("is a no-op on subscribe failure (channelId === null)", async () => {
    const drivers = makeDrivers({
      subscribe: vi.fn().mockRejectedValue(new Error("nope")),
    });
    const lifecycle = new SessionChannelLifecycle(
      "s",
      drivers,
      () => undefined
    );
    await lifecycle.start();
    await lifecycle.dispose();
    expect(drivers.unsubscribe).not.toHaveBeenCalled();
  });

  it("chains unsubscribe onto a slow subscribe (called BEFORE subscribe resolves)", async () => {
    const controllable = makeControllableSubscribe();
    const drivers = makeDrivers({ subscribe: controllable.subscribe });
    const lifecycle = new SessionChannelLifecycle(
      "s",
      drivers,
      () => undefined
    );
    lifecycle.start();
    const disposeP = lifecycle.dispose();
    expect(drivers.unsubscribe).not.toHaveBeenCalled();
    controllable.resolve(99);
    await disposeP;
    expect(drivers.unsubscribe).toHaveBeenCalledWith(99);
  });

  it("is idempotent (repeated dispose only unsubscribes once)", async () => {
    const drivers = makeDrivers();
    const lifecycle = new SessionChannelLifecycle(
      "s",
      drivers,
      () => undefined
    );
    await lifecycle.start();
    await lifecycle.dispose();
    await lifecycle.dispose();
    await lifecycle.dispose();
    expect(drivers.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("warns when the unsubscribe rejects", async () => {
    const drivers = makeDrivers({
      unsubscribe: vi.fn().mockRejectedValue(new Error("registry missing")),
    });
    const lifecycle = new SessionChannelLifecycle(
      "s",
      drivers,
      () => undefined
    );
    await lifecycle.start();
    await lifecycle.dispose();
    expect(drivers.warn).toHaveBeenCalledTimes(1);
    const msg =
      (drivers.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? "";
    expect(String(msg)).toContain("Failed to unsubscribe");
  });

  it("isDestroyed reflects dispose state immediately, before unsubscribe lands", () => {
    const controllable = makeControllableSubscribe();
    const drivers = makeDrivers({ subscribe: controllable.subscribe });
    const lifecycle = new SessionChannelLifecycle(
      "s",
      drivers,
      () => undefined
    );
    lifecycle.start();
    expect(lifecycle.isDestroyed()).toBe(false);
    void lifecycle.dispose();
    expect(lifecycle.isDestroyed()).toBe(true);
  });
});

describe("SessionChannelLifecycle — cross-session race scenarios", () => {
  it("rapid A → B → A: events from the FIRST A do not leak into the SECOND A", async () => {
    // Simulate the React effect being torn down for sessionA, then
    // remounted for sessionA again (e.g. via React StrictMode or a
    // brief switch through sessionB).
    const onFirstA = vi.fn();
    const onSecondA = vi.fn();

    const driversFirstA = makeDrivers({
      subscribe: vi.fn().mockResolvedValue(1),
    });
    const driversSecondA = makeDrivers({
      subscribe: vi.fn().mockResolvedValue(2),
    });

    const firstA = new SessionChannelLifecycle(
      "session-a",
      driversFirstA,
      onFirstA
    );
    await firstA.start();

    // Tauri delivers a message on the first lifecycle.
    const payload = JSON.stringify({
      session_id: "session-a",
      action_type: "noop",
      timestamp: "2025-01-01T00:00:00Z",
    });
    expect(firstA.onMessage(payload)).toBe(true);

    // First lifecycle disposes (effect cleanup).
    await firstA.dispose();

    // Second lifecycle takes over.
    const secondA = new SessionChannelLifecycle(
      "session-a",
      driversSecondA,
      onSecondA
    );
    await secondA.start();

    // Tauri delivers a LATE message on the first channel (between
    // unsubscribe IPC fire and registry actually purging). It MUST
    // be dropped — not forwarded to the second lifecycle's consumer.
    expect(firstA.onMessage(payload)).toBe(false);
    expect(onSecondA).not.toHaveBeenCalled();

    // A normal message on the second channel is delivered.
    expect(secondA.onMessage(payload)).toBe(true);
    expect(onSecondA).toHaveBeenCalledTimes(1);
    expect(onFirstA).toHaveBeenCalledTimes(1);
  });

  it("dispose before subscribe ever resolves: unsubscribe waits, fires with correct id", async () => {
    const controllable = makeControllableSubscribe();
    const drivers = makeDrivers({ subscribe: controllable.subscribe });
    const lifecycle = new SessionChannelLifecycle(
      "s",
      drivers,
      () => undefined
    );
    lifecycle.start();
    const disposeP = lifecycle.dispose();
    // Late subscribe resolution — the id is still picked up by the
    // queued unsubscribe.
    controllable.resolve(77);
    await disposeP;
    expect(drivers.unsubscribe).toHaveBeenCalledTimes(1);
    expect(drivers.unsubscribe).toHaveBeenCalledWith(77);
  });

  it("multiple concurrent lifecycles use independent destroyed flags", async () => {
    const onA = vi.fn();
    const onB = vi.fn();
    const lifecycleA = new SessionChannelLifecycle("a", makeDrivers(), onA);
    const lifecycleB = new SessionChannelLifecycle("b", makeDrivers(), onB);
    await Promise.all([lifecycleA.start(), lifecycleB.start()]);

    const payloadA = JSON.stringify({
      session_id: "a",
      action_type: "noop",
      timestamp: "2025-01-01T00:00:00Z",
    });
    const payloadB = JSON.stringify({
      session_id: "b",
      action_type: "noop",
      timestamp: "2025-01-01T00:00:00Z",
    });
    lifecycleA.onMessage(payloadA);
    lifecycleB.onMessage(payloadB);
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).toHaveBeenCalledTimes(1);

    await lifecycleA.dispose();
    // After A disposes, A's messages stop, but B keeps flowing.
    expect(lifecycleA.onMessage(payloadA)).toBe(false);
    expect(lifecycleB.onMessage(payloadB)).toBe(true);
    expect(onB).toHaveBeenCalledTimes(2);
  });
});

describe("SessionChannelLifecycle — error containment", () => {
  it("warn function is the single point of error reporting", async () => {
    const events: string[] = [];
    const drivers = makeDrivers({
      subscribe: vi.fn().mockRejectedValue(new Error("sub")),
      unsubscribe: vi.fn().mockRejectedValue(new Error("unsub")),
      warn: (msg) => events.push(String(msg)),
    });
    const lifecycle = new SessionChannelLifecycle(
      "s",
      drivers,
      () => undefined
    );
    await lifecycle.start();
    await lifecycle.dispose();
    // Subscribe failed → one warn; channelId is null → no unsubscribe
    // attempt → no second warn.
    expect(events).toHaveLength(1);
    expect(events[0]).toContain("Failed to subscribe");
  });

  it("validation failures inside onMessage do not crash the lifecycle", () => {
    const drivers = makeDrivers();
    const lifecycle = new SessionChannelLifecycle(
      "s",
      drivers,
      () => undefined
    );
    for (let i = 0; i < 100; i++) {
      expect(() => lifecycle.onMessage("not json")).not.toThrow();
    }
    expect(drivers.warn).toHaveBeenCalledTimes(100);
  });
});
