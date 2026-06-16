import { describe, expect, it } from "vitest";

import { looksLikeLargePlainText, looksLikePastedJson } from "../pasteHandlers";

const PADDING_SOURCE = "abcdefghij0123456789".repeat(20);

/** Build a long-enough plain-text payload that would clear the length gate. */
function longPlainText(): string {
  // ~400 chars, no leading "{" or "["
  return PADDING_SOURCE + PADDING_SOURCE;
}

describe("looksLikeLargePlainText", () => {
  it("accepts long single-line plain text", () => {
    expect(looksLikeLargePlainText("x".repeat(4_000))).toBe(true);
  });

  it("accepts many-line plain text even when total length is modest", () => {
    expect(
      looksLikeLargePlainText(Array.from({ length: 80 }, () => "x").join("\n"))
    ).toBe(true);
  });

  it("keeps normal short text inline", () => {
    expect(looksLikeLargePlainText("short\ntext")).toBe(false);
  });
});

describe("looksLikePastedJson", () => {
  it("returns null for plain text long enough to clear the length gate", () => {
    expect(looksLikePastedJson(longPlainText())).toBeNull();
  });

  it("returns null for short JSON below the threshold", () => {
    // 30 chars, well below JSON_PASTE_MIN_LENGTH
    expect(looksLikePastedJson('{"foo":1,"bar":"baz"}')).toBeNull();
  });

  it("returns null for malformed JSON that opens with `{` but cannot parse", () => {
    const broken = `{"foo": "${PADDING_SOURCE}" missingQuote}`;
    expect(broken.length).toBeGreaterThanOrEqual(200);
    expect(looksLikePastedJson(broken)).toBeNull();
  });

  it("returns null for non-JSON that opens with `{` after parse failure", () => {
    // 200+ chars, starts with `{`, but isn't JSON
    const text =
      "{ this is just prose that happens to start with a brace " +
      PADDING_SOURCE;
    expect(looksLikePastedJson(text)).toBeNull();
  });

  it("accepts a long JSON object and picks `pasted.json` when no name field is present", () => {
    const obj = {
      componentLabel: PADDING_SOURCE,
      cssSelector: PADDING_SOURCE,
      domPath: ["body", "div", "span"],
    };
    const hit = looksLikePastedJson(JSON.stringify(obj));
    expect(hit).not.toBeNull();
    expect(hit?.suggestedName).toBe("pasted.json");
    // Pretty output must round-trip to the same object.
    expect(JSON.parse(hit!.pretty)).toEqual(obj);
    expect(hit!.pretty).toContain("\n");
  });

  it("prefers top-level `name` over fallback", () => {
    const obj = {
      name: "MyComponent",
      data: PADDING_SOURCE,
    };
    const hit = looksLikePastedJson(JSON.stringify(obj));
    expect(hit?.suggestedName).toBe("MyComponent.json");
  });

  it("falls back through name → fileName → id → title", () => {
    const obj = {
      fileName: "from-fileName",
      id: "from-id",
      title: "from-title",
      pad: PADDING_SOURCE,
    };
    const hit = looksLikePastedJson(JSON.stringify(obj));
    expect(hit?.suggestedName).toBe("from-fileName.json");
  });

  it("picks `reactComponent.name` when no top-level name is present", () => {
    const obj = {
      componentLabel: PADDING_SOURCE,
      reactComponent: { name: "ComposerShell", fiber: "abc" },
    };
    const hit = looksLikePastedJson(JSON.stringify(obj));
    expect(hit?.suggestedName).toBe("ComposerShell.json");
  });

  it("trims the suggested name to 32 chars before appending the extension", () => {
    const obj = {
      name: "a".repeat(80),
      pad: PADDING_SOURCE,
    };
    const hit = looksLikePastedJson(JSON.stringify(obj));
    expect(hit?.suggestedName).toBe("a".repeat(32) + ".json");
  });

  it("accepts a long JSON array and names it `pasted.json`", () => {
    const arr = Array.from({ length: 30 }, (_, i) => ({
      idx: i,
      tag: PADDING_SOURCE.slice(0, 10),
    }));
    const hit = looksLikePastedJson(JSON.stringify(arr));
    expect(hit?.suggestedName).toBe("pasted.json");
    expect(JSON.parse(hit!.pretty)).toEqual(arr);
  });

  it("handles the documented DevTools-export payload", () => {
    const payload = {
      componentLabel: 'className="relative flex w-full"',
      cssSelector: "div#root > div > " + PADDING_SOURCE,
      reactComponent: { name: "ComposerShell", fiber: "__reactFiber$abc" },
      meta: {
        url: "tauri://localhost/orgii/workstation",
        viewport: { width: 1440, height: 870 },
      },
    };
    const hit = looksLikePastedJson(JSON.stringify(payload));
    expect(hit).not.toBeNull();
    expect(hit?.suggestedName).toBe("ComposerShell.json");
  });
});
