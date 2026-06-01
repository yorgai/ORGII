import { describe, expect, it } from "vitest";

import {
  MODEL_REASONING_LEVEL,
  parseModelVariant,
  resolveModelVariantFields,
} from "./modelVariants";

describe("parseModelVariant", () => {
  it("parses GPT reasoning and fast variants", () => {
    expect(parseModelVariant("gpt-5.5-high-fast")).toEqual({
      model: "gpt-5.5-high-fast",
      baseModel: "gpt-5.5",
      reasoning: MODEL_REASONING_LEVEL.HIGH,
      fast: true,
      rawSuffix: "high",
    });
    expect(parseModelVariant("gpt-5.5-extra-high")).toEqual({
      model: "gpt-5.5-extra-high",
      baseModel: "gpt-5.5",
      reasoning: MODEL_REASONING_LEVEL.EXTRA_HIGH,
      fast: false,
      rawSuffix: "extra-high",
    });
  });

  it("parses GPT thinking, xhigh, and max token variants", () => {
    expect(parseModelVariant("gpt-5.5-xhigh")).toEqual({
      model: "gpt-5.5-xhigh",
      baseModel: "gpt-5.5",
      reasoning: MODEL_REASONING_LEVEL.EXTRA_HIGH,
      fast: false,
      rawSuffix: "xhigh",
    });
    expect(parseModelVariant("gpt-5.5-max")).toEqual({
      model: "gpt-5.5-max",
      baseModel: "gpt-5.5",
      reasoning: MODEL_REASONING_LEVEL.MAX,
      fast: false,
      rawSuffix: "max",
    });
    expect(parseModelVariant("gpt-5.5-thinking-fast")).toEqual({
      model: "gpt-5.5-thinking-fast",
      baseModel: "gpt-5.5",
      reasoning: MODEL_REASONING_LEVEL.LOW,
      fast: true,
      rawSuffix: "thinking",
    });
    expect(parseModelVariant("gpt-5.5-fast")).toEqual({
      model: "gpt-5.5-fast",
      baseModel: "gpt-5.5",
      reasoning: undefined,
      fast: true,
      rawSuffix: undefined,
    });
  });

  it("treats GPT nano/mini/codex as part of the base model", () => {
    expect(parseModelVariant("gpt-5.4-nano-high")).toEqual({
      model: "gpt-5.4-nano-high",
      baseModel: "gpt-5.4-nano",
      reasoning: MODEL_REASONING_LEVEL.HIGH,
      fast: false,
      rawSuffix: "high",
    });
    expect(parseModelVariant("gpt-5.4-nano-none")).toEqual({
      model: "gpt-5.4-nano-none",
      baseModel: "gpt-5.4-nano",
      reasoning: MODEL_REASONING_LEVEL.NONE,
      fast: false,
      rawSuffix: "none",
    });
    expect(parseModelVariant("gpt-5.4-mini-xhigh-fast")).toEqual({
      model: "gpt-5.4-mini-xhigh-fast",
      baseModel: "gpt-5.4-mini",
      reasoning: MODEL_REASONING_LEVEL.EXTRA_HIGH,
      fast: true,
      rawSuffix: "xhigh",
    });
    expect(parseModelVariant("gpt-5.3-codex-thinking")).toEqual({
      model: "gpt-5.3-codex-thinking",
      baseModel: "gpt-5.3-codex",
      reasoning: MODEL_REASONING_LEVEL.LOW,
      fast: false,
      rawSuffix: "thinking",
    });
    expect(parseModelVariant("gpt-5.4-nano")).toBeUndefined();
    expect(parseModelVariant("gpt-5.4-codex")).toBeUndefined();
  });

  it("parses GPT codex-max tier without treating max as reasoning", () => {
    expect(parseModelVariant("gpt-5.1-codex-max")).toBeUndefined();
    expect(parseModelVariant("gpt-5.1-codex-max-low")).toEqual({
      model: "gpt-5.1-codex-max-low",
      baseModel: "gpt-5.1-codex-max",
      reasoning: MODEL_REASONING_LEVEL.LOW,
      fast: false,
      rawSuffix: "low",
    });
    expect(parseModelVariant("gpt-5.1-codex-max-medium")).toEqual({
      model: "gpt-5.1-codex-max-medium",
      baseModel: "gpt-5.1-codex-max",
      reasoning: MODEL_REASONING_LEVEL.MEDIUM,
      fast: false,
      rawSuffix: "medium",
    });
    expect(parseModelVariant("gpt-5.1-codex-max-high")).toEqual({
      model: "gpt-5.1-codex-max-high",
      baseModel: "gpt-5.1-codex-max",
      reasoning: MODEL_REASONING_LEVEL.HIGH,
      fast: false,
      rawSuffix: "high",
    });
    expect(parseModelVariant("gpt-5.1-codex-max-high-fast")).toEqual({
      model: "gpt-5.1-codex-max-high-fast",
      baseModel: "gpt-5.1-codex-max",
      reasoning: MODEL_REASONING_LEVEL.HIGH,
      fast: true,
      rawSuffix: "high",
    });
    expect(parseModelVariant("gpt-5.1-codex-mini-high")).toEqual({
      model: "gpt-5.1-codex-mini-high",
      baseModel: "gpt-5.1-codex-mini",
      reasoning: MODEL_REASONING_LEVEL.HIGH,
      fast: false,
      rawSuffix: "high",
    });
    expect(parseModelVariant("gpt-5.2-codex-fast")).toEqual({
      model: "gpt-5.2-codex-fast",
      baseModel: "gpt-5.2-codex",
      reasoning: undefined,
      fast: true,
      rawSuffix: undefined,
    });
  });

  it("parses Claude suffix variants without changing unrelated Claude names", () => {
    expect(parseModelVariant("claude-sonnet-4-5-medium-fast")).toEqual({
      model: "claude-sonnet-4-5-medium-fast",
      baseModel: "claude-sonnet-4-5",
      reasoning: MODEL_REASONING_LEVEL.MEDIUM,
      fast: true,
      rawSuffix: "medium",
    });
    expect(parseModelVariant("claude-sonnet-4-5")).toBeUndefined();
  });

  it("parses Anthropic thinking, xhigh, and max token variants", () => {
    expect(parseModelVariant("claude-opus-4-7-thinking")).toEqual({
      model: "claude-opus-4-7-thinking",
      baseModel: "claude-opus-4-7",
      reasoning: MODEL_REASONING_LEVEL.LOW,
      fast: false,
      rawSuffix: "thinking",
    });
    expect(parseModelVariant("claude-opus-4-7-thinking-xhigh")).toEqual({
      model: "claude-opus-4-7-thinking-xhigh",
      baseModel: "claude-opus-4-7",
      reasoning: MODEL_REASONING_LEVEL.EXTRA_HIGH,
      fast: false,
      rawSuffix: "thinking-xhigh",
    });
    expect(parseModelVariant("claude-4.6-opus-high-thinking")).toEqual({
      model: "claude-4.6-opus-high-thinking",
      baseModel: "claude-4.6-opus",
      reasoning: MODEL_REASONING_LEVEL.HIGH,
      fast: false,
      rawSuffix: "high-thinking",
    });
    expect(parseModelVariant("claude-4.6-opus-max-thinking")).toEqual({
      model: "claude-4.6-opus-max-thinking",
      baseModel: "claude-4.6-opus",
      reasoning: MODEL_REASONING_LEVEL.MAX,
      fast: false,
      rawSuffix: "max-thinking",
    });
  });

  it("parses O-series reasoning variants", () => {
    expect(parseModelVariant("o5.5-high")).toEqual({
      model: "o5.5-high",
      baseModel: "o5.5",
      reasoning: MODEL_REASONING_LEVEL.HIGH,
      fast: false,
      rawSuffix: "high",
    });
    expect(parseModelVariant("o5.5-low")).toEqual({
      model: "o5.5-low",
      baseModel: "o5.5",
      reasoning: MODEL_REASONING_LEVEL.LOW,
      fast: false,
      rawSuffix: "low",
    });
    expect(parseModelVariant("o5.5-minimal")).toEqual({
      model: "o5.5-minimal",
      baseModel: "o5.5",
      reasoning: undefined,
      fast: false,
      rawSuffix: "minimal",
    });
    expect(parseModelVariant("o5.4-high")).toEqual({
      model: "o5.4-high",
      baseModel: "o5.4",
      reasoning: MODEL_REASONING_LEVEL.HIGH,
      fast: false,
      rawSuffix: "high",
    });
    expect(parseModelVariant("o5.4-minimal")).toEqual({
      model: "o5.4-minimal",
      baseModel: "o5.4",
      reasoning: undefined,
      fast: false,
      rawSuffix: "minimal",
    });
    expect(parseModelVariant("o5.5")).toBeUndefined();
    expect(parseModelVariant("o5.4-mini")).toEqual({
      model: "o5.4-mini",
      baseModel: "o5.4",
      reasoning: undefined,
      fast: false,
      rawSuffix: "mini",
    });
    expect(parseModelVariant("o5.4-nano")).toEqual({
      model: "o5.4-nano",
      baseModel: "o5.4",
      reasoning: undefined,
      fast: false,
      rawSuffix: "nano",
    });
    expect(parseModelVariant("o5-chat")).toBeUndefined();
  });

  it("parses Composer fast variants", () => {
    expect(parseModelVariant("composer-2.5-fast")).toEqual({
      model: "composer-2.5-fast",
      baseModel: "composer-2.5",
      reasoning: undefined,
      fast: true,
      rawSuffix: undefined,
    });
    expect(parseModelVariant("composer-2-fast")).toEqual({
      model: "composer-2-fast",
      baseModel: "composer-2",
      reasoning: undefined,
      fast: true,
      rawSuffix: undefined,
    });
    expect(parseModelVariant("composer-2.5")).toBeUndefined();
  });

  it("ignores unsupported non GPT, non Claude, and non Composer variants", () => {
    expect(parseModelVariant("gemini-2.5-pro-fast")).toBeUndefined();
    expect(parseModelVariant("composer-2.5-pro-fast")).toBeUndefined();
  });

  it("prefers frontend parse over stale backend model variant metadata", () => {
    expect(
      resolveModelVariantFields("gpt-5.1-codex-max-medium", {
        model: "gpt-5.1-codex-max-medium",
        base_model: "gpt-5.1-codex-max-medium",
        reasoning: "max",
        fast: false,
      })
    ).toEqual({
      model: "gpt-5.1-codex-max-medium",
      base_model: "gpt-5.1-codex-max",
      reasoning: MODEL_REASONING_LEVEL.MEDIUM,
      fast: false,
    });
  });
});
