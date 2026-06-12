/**
 * editorAtom — primitive Jotai atoms for the code editor UI.
 *
 * These atoms hold plain primitives (boolean / string / range | null) so the
 * only testable logic is initial default values and basic read/write via a
 * Jotai store.
 */
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import {
  curSelectFileNameAtom,
  editorChatVisibleAtom,
  isCiteCodeAtom,
  selectedCiteRangeAtom,
  selectedCiteTextAtom,
} from "../editorAtom";

function makeStore() {
  return createStore();
}

describe("editorChatVisibleAtom", () => {
  it("defaults to false", () => {
    expect(makeStore().get(editorChatVisibleAtom)).toBe(false);
  });

  it("reflects writes", () => {
    const store = makeStore();
    store.set(editorChatVisibleAtom, true);
    expect(store.get(editorChatVisibleAtom)).toBe(true);
  });

  it("can be toggled back to false", () => {
    const store = makeStore();
    store.set(editorChatVisibleAtom, true);
    store.set(editorChatVisibleAtom, false);
    expect(store.get(editorChatVisibleAtom)).toBe(false);
  });
});

describe("selectedCiteTextAtom", () => {
  it("defaults to empty string", () => {
    expect(makeStore().get(selectedCiteTextAtom)).toBe("");
  });

  it("stores multiline text verbatim", () => {
    const store = makeStore();
    const code = "const x = 1;\nconst y = 2;";
    store.set(selectedCiteTextAtom, code);
    expect(store.get(selectedCiteTextAtom)).toBe(code);
  });
});

describe("selectedCiteRangeAtom", () => {
  it("defaults to null", () => {
    expect(makeStore().get(selectedCiteRangeAtom)).toBeNull();
  });

  it("stores start/end line range", () => {
    const store = makeStore();
    store.set(selectedCiteRangeAtom, { start: 5, end: 20 });
    expect(store.get(selectedCiteRangeAtom)).toEqual({ start: 5, end: 20 });
  });

  it("can be reset to null", () => {
    const store = makeStore();
    store.set(selectedCiteRangeAtom, { start: 1, end: 5 });
    store.set(selectedCiteRangeAtom, null);
    expect(store.get(selectedCiteRangeAtom)).toBeNull();
  });

  it("handles single-line range (start === end)", () => {
    const store = makeStore();
    store.set(selectedCiteRangeAtom, { start: 42, end: 42 });
    expect(store.get(selectedCiteRangeAtom)).toEqual({ start: 42, end: 42 });
  });
});

describe("isCiteCodeAtom", () => {
  it("defaults to false", () => {
    expect(makeStore().get(isCiteCodeAtom)).toBe(false);
  });

  it("can be set to true", () => {
    const store = makeStore();
    store.set(isCiteCodeAtom, true);
    expect(store.get(isCiteCodeAtom)).toBe(true);
  });
});

describe("curSelectFileNameAtom", () => {
  it("defaults to empty string", () => {
    expect(makeStore().get(curSelectFileNameAtom)).toBe("");
  });

  it("stores a file name", () => {
    const store = makeStore();
    store.set(curSelectFileNameAtom, "src/components/Button.tsx");
    expect(store.get(curSelectFileNameAtom)).toBe("src/components/Button.tsx");
  });
});
