import { describe, expect, it } from "vitest";

import {
  type DraftRestoreInput,
  resolveDraftRestoreAction,
} from "../draftRestore";

function createInput(
  overrides: Partial<DraftRestoreInput> = {}
): DraftRestoreInput {
  return {
    draftSessionId: "session-b",
    seededSessionId: null,
    hasEditor: true,
    mentionMenuOpen: false,
    persistedDraft: null,
    skipReason: null,
    ...overrides,
  };
}

describe("resolveDraftRestoreAction", () => {
  it("resets the seed marker when there is no session id", () => {
    expect(resolveDraftRestoreAction(createInput({ draftSessionId: "" }))).toBe(
      "reset-seed"
    );
  });

  it("skips when already seeded for the same session", () => {
    expect(
      resolveDraftRestoreAction(
        createInput({
          draftSessionId: "session-b",
          seededSessionId: "session-b",
        })
      )
    ).toBe("skip");
  });

  it("waits (without marking seeded) when the editor is not mounted yet", () => {
    expect(resolveDraftRestoreAction(createInput({ hasEditor: false }))).toBe(
      "wait"
    );
  });

  it("clears for an empty draft on a fresh session", () => {
    expect(
      resolveDraftRestoreAction(createInput({ persistedDraft: null }))
    ).toBe("clear");
    expect(resolveDraftRestoreAction(createInput({ persistedDraft: "" }))).toBe(
      "clear"
    );
  });

  it("clears when the draft is malformed (skipReason set)", () => {
    expect(
      resolveDraftRestoreAction(
        createInput({ persistedDraft: "garbage", skipReason: "too-long" })
      )
    ).toBe("clear");
  });

  it("restores a valid persisted draft on a fresh session", () => {
    expect(
      resolveDraftRestoreAction(
        createInput({ persistedDraft: "hello world", skipReason: null })
      )
    ).toBe("restore");
  });

  describe("open-menu guard (the concurrent-works slash popup bug)", () => {
    it("does not clobber when a menu is open, even with an empty draft", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({ mentionMenuOpen: true, persistedDraft: null })
        )
      ).toBe("skip-open-menu");
    });

    it("does not clobber when a menu is open, even with a restorable draft", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({ mentionMenuOpen: true, persistedDraft: "draft text" })
        )
      ).toBe("skip-open-menu");
    });

    it("does not clobber when a menu is open and the draft is malformed", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({
            mentionMenuOpen: true,
            persistedDraft: "garbage",
            skipReason: "too-long",
          })
        )
      ).toBe("skip-open-menu");
    });

    it("still skips for an already-seeded session regardless of menu state", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({
            seededSessionId: "session-b",
            mentionMenuOpen: true,
          })
        )
      ).toBe("skip");
    });

    it("still waits for an unmounted editor regardless of menu state", () => {
      // A menu cannot truly be open without a mounted editor, but the
      // mount check must take precedence to avoid marking seeded too early.
      expect(
        resolveDraftRestoreAction(
          createInput({ hasEditor: false, mentionMenuOpen: true })
        )
      ).toBe("wait");
    });
  });
});
