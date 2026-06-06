import { describe, expect, it } from "vitest";

import { removeSnapshotTextRange } from "../snapshotRanges";
import type { ComposerSnapshot } from "../types";

const filePill = {
  kind: "pill" as const,
  attrs: {
    filePath: "/workspace/secondary/src/index.tsx",
    fileName: "index.tsx",
    isFolder: false,
    iconType: "file" as const,
    lineStart: null,
    lineEnd: null,
  },
};

describe("ComposerInput snapshot ranges", () => {
  it("removes only an inline @ query and preserves trigger-prefix draft text", () => {
    const snapshot: ComposerSnapshot = {
      parts: [{ kind: "text", text: "before @index.tsx" }],
    };

    const [textPart] = snapshot.parts;
    if (textPart.kind !== "text") throw new Error("expected text part");

    expect(
      removeSnapshotTextRange(snapshot, "before ".length, textPart.text.length)
    ).toEqual({
      parts: [{ kind: "text", text: "before " }],
    });
  });

  it("preserves pills and text outside the consumed query range", () => {
    const snapshot: ComposerSnapshot = {
      parts: [
        { kind: "text", text: "review " },
        filePill,
        { kind: "text", text: " before @index.tsx please" },
      ],
    };
    const startOffset =
      "review ".length + "index.tsx".length + " before ".length;
    const endOffset = startOffset + "@index.tsx".length;

    expect(removeSnapshotTextRange(snapshot, startOffset, endOffset)).toEqual({
      parts: [
        { kind: "text", text: "review " },
        filePill,
        { kind: "text", text: " before  please" },
      ],
    });
  });
});
