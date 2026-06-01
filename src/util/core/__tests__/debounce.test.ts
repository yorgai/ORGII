import { vi } from "vitest";

import { debounce, debounceAsync } from "../debounce";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call the function immediately with trailing edge default", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls the function after the wait period", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending call with .cancel()", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });

  it("flushes immediately with .flush()", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced("arg");
    expect(fn).not.toHaveBeenCalled();
    debounced.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("arg");
  });

  it("reports .pending() true when a timer is active, false otherwise", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    expect(debounced.pending()).toBe(false);
    debounced();
    expect(debounced.pending()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(debounced.pending()).toBe(false);
  });

  it("with leading option, calls immediately on first invocation", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100, { leading: true });

    debounced("first");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("first");
  });

  it("with maxWait, invokes after maxWait even when calls keep coming", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200, { maxWait: 150 });

    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("executes only once for multiple rapid trailing calls", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced(1);
    debounced(2);
    debounced(3);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });
});

describe("debounceAsync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a Promise", () => {
    const fn = vi.fn(() => 42);
    const debounced = debounceAsync(fn, 50);
    const result = debounced();
    expect(result).toBeInstanceOf(Promise);
  });

  it("resolves after the delay", async () => {
    const fn = vi.fn(() => "done");
    const debounced = debounceAsync(fn, 80);
    const promise = debounced();
    vi.advanceTimersByTime(80);
    await expect(promise).resolves.toBe("done");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("with immediate option, invokes on the first call without waiting", async () => {
    const fn = vi.fn(() => "now");
    const debounced = debounceAsync(fn, 200, { immediate: true });
    const promise = debounced();
    await expect(promise).resolves.toBe("now");
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
