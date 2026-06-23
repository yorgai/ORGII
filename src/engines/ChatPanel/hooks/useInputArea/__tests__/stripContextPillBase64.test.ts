import { describe, expect, it } from "vitest";

import { stripContextPillBase64 } from "../useSubmitMessage";

describe("stripContextPillBase64", () => {
  it("drops the ::base64 payload from a paste pill, keeping the reference", () => {
    const input = "pasted.txt [paste:paste://123-abc::TVMlMjBlbmNvZGVk]";
    expect(stripContextPillBase64(input)).toBe(
      "pasted.txt [paste:paste://123-abc]"
    );
  });

  it("leaves a paste pill without a payload untouched", () => {
    const input = "pasted.txt [paste:paste://123-abc]";
    expect(stripContextPillBase64(input)).toBe(input);
  });

  it("strips multiple context pills in one message", () => {
    const input =
      "a [paste:paste://1::QQ==] b [terminal:terminal://2/9::Qg==] c";
    expect(stripContextPillBase64(input)).toBe(
      "a [paste:paste://1] b [terminal:terminal://2/9] c"
    );
  });

  it("strips DOM component browser-inspect pill payloads", () => {
    const input = "Button.json [dom-component:paste://inspect-1::QQ==]";
    expect(stripContextPillBase64(input)).toBe(
      "Button.json [dom-component:paste://inspect-1]"
    );
  });

  it("does not touch file/session/skill pills", () => {
    const input = "x [file:/repo/a.ts] y [session:sdeagent-1] z [skill:/foo]";
    expect(stripContextPillBase64(input)).toBe(input);
  });

  it("preserves surrounding plaintext and fenced blocks", () => {
    const input = "review [paste:paste://1::QQ==]\n\n```\nactual content\n```";
    expect(stripContextPillBase64(input)).toBe(
      "review [paste:paste://1]\n\n```\nactual content\n```"
    );
  });
});
