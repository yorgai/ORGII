/**
 * Unit tests for the {@link CallbackRefEffectLifecycle} state
 * machine that backs {@link useCallbackRefEffect}.
 *
 * We test the lifecycle directly (without a React renderer) because
 * the host project doesn't ship `@testing-library/react` or `jsdom`.
 * The hook itself is a thin wrapper that:
 *   - Creates a `CallbackRefEffectLifecycle` instance on first render.
 *   - Forwards `attach(el | null)` from the JSX ref-callback.
 *   - Forwards `rerunOnDepChange()` from `useEffect(_, deps)` whenever
 *     the deps change.
 *   - Forwards `dispose()` from the `useEffect` cleanup at unmount.
 *
 * By exercising those three transitions directly, we cover every
 * branch the hook can hit without simulating React.
 *
 * Coverage:
 *   - First-attach fires setup; re-attach with the same element is a
 *     no-op.
 *   - Detach (`attach(null)`) fires cleanup.
 *   - Element replacement (`attach(other)`) fires cleanup for the
 *     previous element before setup for the new one.
 *   - `rerunOnDepChange()` re-runs setup with the current element;
 *     no-op when no element is attached.
 *   - `dispose()` always runs cleanup and clears state; safe to call
 *     repeatedly.
 *   - `updateSetup()` lets later renders' captured closures replace
 *     the stored one without forcing a teardown/rebuild.
 *   - Setup / cleanup callback errors are contained and reported
 *     via the injected warn function.
 *   - The cleanup half is idempotent — calling `dispose` after a
 *     detach does not double-fire.
 *   - Setup that returns `void` (no cleanup) is handled the same as
 *     setup that returns a function.
 */
import { describe, expect, it, vi } from "vitest";

import { CallbackRefEffectLifecycle } from "../useCallbackRefEffect";

/**
 * Test helper: build a fake "element" with a unique identity. The
 * lifecycle treats elements as opaque object identities so any
 * unique object works.
 */
function fakeEl(name: string): HTMLDivElement {
  // We don't actually need an HTMLElement — the lifecycle only checks
  // identity. But typing the test that way makes the call sites
  // closer to real usage.
  return { __mock: name } as unknown as HTMLDivElement;
}

describe("CallbackRefEffectLifecycle — first attach / detach", () => {
  it("calls setup with the element on first attach", () => {
    const setup = vi.fn();
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);
    const el = fakeEl("a");
    lifecycle.attach(el);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledWith(el);
    expect(lifecycle.getElement()).toBe(el);
  });

  it("does not call setup when attaching null while already null", () => {
    const setup = vi.fn();
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);
    lifecycle.attach(null);
    expect(setup).not.toHaveBeenCalled();
    expect(lifecycle.getElement()).toBeNull();
  });

  it("calls cleanup on detach (attach(null))", () => {
    const cleanup = vi.fn();
    const setup = vi.fn().mockReturnValue(cleanup);
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);
    const el = fakeEl("a");
    lifecycle.attach(el);
    expect(cleanup).not.toHaveBeenCalled();
    lifecycle.attach(null);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(lifecycle.getElement()).toBeNull();
  });

  it("treats re-attach of the same element as a no-op (idempotent)", () => {
    const cleanup = vi.fn();
    const setup = vi.fn().mockReturnValue(cleanup);
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);
    const el = fakeEl("a");
    lifecycle.attach(el);
    lifecycle.attach(el);
    lifecycle.attach(el);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("swaps elements: cleanup for old, setup for new", () => {
    const cleanup = vi.fn();
    const setup = vi.fn().mockImplementation(() => {
      return cleanup;
    });
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);
    const a = fakeEl("a");
    const b = fakeEl("b");

    lifecycle.attach(a);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenLastCalledWith(a);
    expect(cleanup).not.toHaveBeenCalled();

    lifecycle.attach(b);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledTimes(2);
    expect(setup).toHaveBeenLastCalledWith(b);
    expect(lifecycle.getElement()).toBe(b);
  });
});

describe("CallbackRefEffectLifecycle — rerunOnDepChange", () => {
  it("re-runs cleanup + setup against the current element", () => {
    const cleanup = vi.fn();
    const setup = vi.fn().mockReturnValue(cleanup);
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);
    const el = fakeEl("a");
    lifecycle.attach(el);
    expect(setup).toHaveBeenCalledTimes(1);

    lifecycle.rerunOnDepChange();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledTimes(2);
    expect(setup).toHaveBeenLastCalledWith(el);

    lifecycle.rerunOnDepChange();
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(setup).toHaveBeenCalledTimes(3);
  });

  it("is a no-op when no element is attached", () => {
    const setup = vi.fn();
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);
    lifecycle.rerunOnDepChange();
    lifecycle.rerunOnDepChange();
    expect(setup).not.toHaveBeenCalled();
  });

  it("uses the updated setup closure after updateSetup", () => {
    const cleanup = vi.fn();
    const setupA = vi.fn().mockReturnValue(cleanup);
    const setupB = vi.fn().mockReturnValue(cleanup);
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setupA);
    const el = fakeEl("a");
    lifecycle.attach(el);
    expect(setupA).toHaveBeenCalledTimes(1);

    lifecycle.updateSetup(setupB);
    lifecycle.rerunOnDepChange();
    expect(setupB).toHaveBeenCalledTimes(1);
    expect(setupA).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe("CallbackRefEffectLifecycle — dispose", () => {
  it("runs cleanup and clears the element", () => {
    const cleanup = vi.fn();
    const setup = vi.fn().mockReturnValue(cleanup);
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);
    const el = fakeEl("a");
    lifecycle.attach(el);
    lifecycle.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(lifecycle.getElement()).toBeNull();
  });

  it("is idempotent (multiple dispose calls don't re-fire cleanup)", () => {
    const cleanup = vi.fn();
    const setup = vi.fn().mockReturnValue(cleanup);
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);
    const el = fakeEl("a");
    lifecycle.attach(el);
    lifecycle.dispose();
    lifecycle.dispose();
    lifecycle.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("is a safe no-op when no element was ever attached", () => {
    const setup = vi.fn();
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);
    expect(() => lifecycle.dispose()).not.toThrow();
    expect(setup).not.toHaveBeenCalled();
  });

  it("does not double-fire cleanup after detach + dispose", () => {
    const cleanup = vi.fn();
    const setup = vi.fn().mockReturnValue(cleanup);
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);
    const el = fakeEl("a");
    lifecycle.attach(el);
    lifecycle.attach(null);
    lifecycle.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe("CallbackRefEffectLifecycle — setup return shape", () => {
  it("handles setup that returns void (no cleanup)", () => {
    const setup = vi.fn().mockReturnValue(undefined);
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);
    const el = fakeEl("a");
    lifecycle.attach(el);
    expect(() => lifecycle.attach(null)).not.toThrow();
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it("ignores non-function return values from setup", () => {
    // Defensive: in plain TS the type rules this out, but a JS
    // caller could pass a setup that returns a string. We just
    // skip the cleanup phase rather than crash.
    const setup = vi
      .fn<(el: HTMLDivElement) => unknown>()
      .mockReturnValue("not a function");
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(
      setup as never
    );
    lifecycle.attach(fakeEl("a"));
    expect(() => lifecycle.attach(null)).not.toThrow();
  });

  it("calls cleanup with no arguments", () => {
    const cleanup = vi.fn();
    const setup = vi.fn().mockReturnValue(cleanup);
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);
    lifecycle.attach(fakeEl("a"));
    lifecycle.attach(null);
    expect(cleanup).toHaveBeenCalledWith();
    expect(cleanup.mock.calls[0]).toEqual([]);
  });
});

describe("CallbackRefEffectLifecycle — error containment", () => {
  it("setup throw is reported via warn and lifecycle stays consistent", () => {
    const warn = vi.fn();
    const setup = vi.fn().mockImplementation(() => {
      throw new Error("setup bang");
    });
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(
      setup,
      warn
    );
    lifecycle.attach(fakeEl("a"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0]?.[0] as string) ?? "").toContain(
      "setup callback threw"
    );
    // No cleanup stored — subsequent detach must NOT re-throw.
    expect(() => lifecycle.attach(null)).not.toThrow();
  });

  it("cleanup throw is reported via warn and lifecycle stays consistent", () => {
    const warn = vi.fn();
    const setup = vi.fn().mockReturnValue(() => {
      throw new Error("cleanup bang");
    });
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(
      setup,
      warn
    );
    lifecycle.attach(fakeEl("a"));
    expect(() => lifecycle.attach(null)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0]?.[0] as string) ?? "").toContain(
      "cleanup callback threw"
    );
  });

  it("error in cleanup during element swap still installs the new setup", () => {
    const warn = vi.fn();
    const setup = vi.fn().mockImplementation(() => {
      return () => {
        throw new Error("cleanup bang");
      };
    });
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(
      setup,
      warn
    );
    lifecycle.attach(fakeEl("a"));
    lifecycle.attach(fakeEl("b"));
    expect(setup).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("error in cleanup during rerunOnDepChange still installs the new setup", () => {
    const warn = vi.fn();
    let runs = 0;
    const setup = vi.fn().mockImplementation(() => {
      runs += 1;
      return () => {
        throw new Error("cleanup bang");
      };
    });
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(
      setup,
      warn
    );
    lifecycle.attach(fakeEl("a"));
    lifecycle.rerunOnDepChange();
    lifecycle.rerunOnDepChange();
    expect(runs).toBe(3);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("falls back to console.warn when no warn callback is injected", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(() => {
      throw new Error("boom");
    });
    lifecycle.attach(fakeEl("a"));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("CallbackRefEffectLifecycle — realistic scenarios", () => {
  it("models the canonical 'element mounts AFTER first render' fix", () => {
    // Render 1: parent renders, hook initializes, no element attached.
    // Render 2: condition flips, element mounts, attach fires setup.
    // Render 3: deps change, rerun cleanup+setup.
    // Render 4: condition flips back, detach fires cleanup.
    // Unmount: dispose is a no-op (element already detached).
    const setup = vi.fn().mockImplementation(() => {
      const fn = vi.fn();
      return fn;
    });
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);

    // Render 1.
    expect(setup).not.toHaveBeenCalled();

    // Render 2.
    lifecycle.attach(fakeEl("content"));
    expect(setup).toHaveBeenCalledTimes(1);
    const firstCleanup = setup.mock.results[0]?.value as ReturnType<
      typeof vi.fn
    >;

    // Render 3.
    lifecycle.rerunOnDepChange();
    expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledTimes(2);
    const secondCleanup = setup.mock.results[1]?.value as ReturnType<
      typeof vi.fn
    >;

    // Render 4.
    lifecycle.attach(null);
    expect(secondCleanup).toHaveBeenCalledTimes(1);

    // Unmount.
    lifecycle.dispose();
    expect(secondCleanup).toHaveBeenCalledTimes(1);
  });

  it("survives a long sequence of attach/detach/dep-change with no leaks", () => {
    let outstanding = 0;
    const setup = vi.fn().mockImplementation(() => {
      outstanding += 1;
      return () => {
        outstanding -= 1;
      };
    });
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);

    // Hammer the lifecycle.
    for (let i = 0; i < 100; i++) {
      lifecycle.attach(fakeEl(`e-${i}`));
      lifecycle.rerunOnDepChange();
      lifecycle.rerunOnDepChange();
      lifecycle.attach(null);
    }
    expect(outstanding).toBe(0);
    lifecycle.dispose();
    expect(outstanding).toBe(0);
  });

  it("after dispose, further attach calls do not crash but element is rebound", () => {
    // Defensive: a "zombie" reference to the ref-callback after the
    // host component unmounts must not crash. (React technically
    // shouldn't call the ref-callback again after unmount, but
    // memory-leaked subscriptions might.)
    const cleanup = vi.fn();
    const setup = vi.fn().mockReturnValue(cleanup);
    const lifecycle = new CallbackRefEffectLifecycle<HTMLDivElement>(setup);
    lifecycle.attach(fakeEl("a"));
    lifecycle.dispose();
    expect(() => lifecycle.attach(fakeEl("b"))).not.toThrow();
    // The lifecycle DID rebind — by design it's just a state
    // machine, not a "I've been disposed, ignore further calls"
    // guard. The hook layer above ensures we don't get into this
    // state in practice.
    expect(setup).toHaveBeenCalledTimes(2);
  });
});
