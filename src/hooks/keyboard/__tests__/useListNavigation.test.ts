/**
 * Unit tests for {@link findNextSelectableIndex} — the pure navigation
 * primitive that powers {@link useListNavigation}'s ArrowUp / ArrowDown
 * handling.
 *
 * The hook itself is a thin React shell around this helper, so testing
 * the helper directly covers every navigation outcome without needing a
 * React renderer (the host project doesn't ship `@testing-library/react`
 * or `jsdom`).
 *
 * Behavior under test:
 * - ArrowDown (direction = +1) advances to the next selectable index.
 * - ArrowUp (direction = -1) walks back to the previous selectable index.
 * - "wrap" is intentionally NOT implemented — once you hit the first or
 *   last selectable item, further presses in that direction clamp at the
 *   boundary (the function returns the same `startIndex`).
 * - When `startIndex < 0`, the search begins at the first item for +1 or
 *   the last item for -1 (initial-selection semantics).
 * - Non-selectable items are skipped over.
 * - Empty lists yield -1.
 *
 * Note: Home / End keys are deliberately NOT handled by `useListNavigation`,
 * so no Home / End test cases exist — only ArrowUp / ArrowDown navigation
 * and boundary-clamp ("no wrap") coverage.
 */
import { describe, expect, it } from "vitest";

import { findNextSelectableIndex } from "../useListNavigation";

interface TestItem {
  id: string;
  disabled?: boolean;
}

const items: TestItem[] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

const itemsWithGaps: TestItem[] = [
  { id: "a" },
  { id: "b", disabled: true },
  { id: "c", disabled: true },
  { id: "d" },
  { id: "e", disabled: true },
  { id: "f" },
];

const allDisabled: TestItem[] = [
  { id: "a", disabled: true },
  { id: "b", disabled: true },
];

const isEnabled = (item: TestItem) => !item.disabled;

describe("findNextSelectableIndex — ArrowDown (direction = +1)", () => {
  it("advances to the next index when every item is selectable", () => {
    expect(findNextSelectableIndex(items, 0, 1)).toBe(1);
    expect(findNextSelectableIndex(items, 1, 1)).toBe(2);
    expect(findNextSelectableIndex(items, 2, 1)).toBe(3);
  });

  it("skips over non-selectable items", () => {
    // From index 0 ('a'), next selectable forward is 'd' at index 3
    // (indices 1, 2 are disabled).
    expect(findNextSelectableIndex(itemsWithGaps, 0, 1, isEnabled)).toBe(3);
    // From index 3 ('d'), next selectable forward is 'f' at index 5
    // (index 4 is disabled).
    expect(findNextSelectableIndex(itemsWithGaps, 3, 1, isEnabled)).toBe(5);
  });

  it("clamps at the last index without wrapping", () => {
    // ArrowDown at the bottom row stays put — no wrap to the top.
    expect(findNextSelectableIndex(items, 3, 1)).toBe(3);
    expect(findNextSelectableIndex(itemsWithGaps, 5, 1, isEnabled)).toBe(5);
  });
});

describe("findNextSelectableIndex — ArrowUp (direction = -1)", () => {
  it("walks back to the previous index when every item is selectable", () => {
    expect(findNextSelectableIndex(items, 3, -1)).toBe(2);
    expect(findNextSelectableIndex(items, 2, -1)).toBe(1);
    expect(findNextSelectableIndex(items, 1, -1)).toBe(0);
  });

  it("skips over non-selectable items", () => {
    // From index 5 ('f'), previous selectable is 'd' at index 3
    // (index 4 is disabled).
    expect(findNextSelectableIndex(itemsWithGaps, 5, -1, isEnabled)).toBe(3);
    // From index 3 ('d'), previous selectable is 'a' at index 0
    // (indices 1, 2 are disabled).
    expect(findNextSelectableIndex(itemsWithGaps, 3, -1, isEnabled)).toBe(0);
  });

  it("clamps at the first index without wrapping", () => {
    // ArrowUp at the top row stays put — no wrap to the bottom.
    expect(findNextSelectableIndex(items, 0, -1)).toBe(0);
    expect(findNextSelectableIndex(itemsWithGaps, 0, -1, isEnabled)).toBe(0);
  });
});

describe("findNextSelectableIndex — initial selection (startIndex < 0)", () => {
  it("returns the first selectable item for direction = +1", () => {
    expect(findNextSelectableIndex(items, -1, 1)).toBe(0);
    expect(findNextSelectableIndex(itemsWithGaps, -1, 1, isEnabled)).toBe(0);
  });

  it("returns the last selectable item for direction = -1", () => {
    expect(findNextSelectableIndex(items, -1, -1)).toBe(3);
    // Last selectable item is 'f' at index 5.
    expect(findNextSelectableIndex(itemsWithGaps, -1, -1, isEnabled)).toBe(5);
  });

  it("skips leading disabled items when seeding forward", () => {
    const leadingDisabled: TestItem[] = [
      { id: "a", disabled: true },
      { id: "b", disabled: true },
      { id: "c" },
      { id: "d" },
    ];
    expect(findNextSelectableIndex(leadingDisabled, -1, 1, isEnabled)).toBe(2);
  });

  it("skips trailing disabled items when seeding backward", () => {
    const trailingDisabled: TestItem[] = [
      { id: "a" },
      { id: "b" },
      { id: "c", disabled: true },
      { id: "d", disabled: true },
    ];
    expect(findNextSelectableIndex(trailingDisabled, -1, -1, isEnabled)).toBe(
      1
    );
  });
});

describe("findNextSelectableIndex — empty and fully-disabled lists", () => {
  it("returns -1 for an empty list", () => {
    expect(findNextSelectableIndex<TestItem>([], 0, 1)).toBe(-1);
    expect(findNextSelectableIndex<TestItem>([], -1, 1)).toBe(-1);
    expect(findNextSelectableIndex<TestItem>([], 0, -1)).toBe(-1);
    expect(findNextSelectableIndex<TestItem>([], -1, -1)).toBe(-1);
  });

  it("returns -1 when seeding (startIndex < 0) into a fully-disabled list", () => {
    expect(findNextSelectableIndex(allDisabled, -1, 1, isEnabled)).toBe(-1);
    expect(findNextSelectableIndex(allDisabled, -1, -1, isEnabled)).toBe(-1);
  });

  it("clamps to startIndex when no selectable item exists ahead", () => {
    // Already on a (selectable) item but nothing selectable in that
    // direction → stay put.
    const oneSelectable: TestItem[] = [
      { id: "a" },
      { id: "b", disabled: true },
      { id: "c", disabled: true },
    ];
    expect(findNextSelectableIndex(oneSelectable, 0, 1, isEnabled)).toBe(0);
  });
});

describe("findNextSelectableIndex — predicate receives correct args", () => {
  it("passes (item, index) to the predicate", () => {
    const seen: Array<[TestItem, number]> = [];
    findNextSelectableIndex(items, 0, 1, (item, index) => {
      seen.push([item, index]);
      return true;
    });
    expect(seen).toEqual([[items[1], 1]]);
  });

  it("defaults to 'every item selectable' when no predicate is supplied", () => {
    expect(findNextSelectableIndex(itemsWithGaps, 0, 1)).toBe(1);
    expect(findNextSelectableIndex(itemsWithGaps, 5, -1)).toBe(4);
  });
});
