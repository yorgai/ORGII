import { describe, expect, it } from "vitest";

import { NATIVE_HARNESS_TYPE } from "@src/api/tauri/rpc/schemas/validation";
import { CLI_AGENT } from "@src/api/types/keys";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";

import {
  getClaudeCodeOAuthModels,
  getMyKeyFallbackNativeModels,
  withClaudeCodeOAuthModels,
  withCursorNativeModels,
} from "./nativeHarnessAccountModels";

describe("native harness account models", () => {
  it("uses Composer 2 as the Cursor native fallback model", () => {
    expect(getMyKeyFallbackNativeModels(NATIVE_HARNESS_TYPE.CURSOR)).toEqual([
      "composer-2",
    ]);
  });

  it("uses Claude Code CLI-compatible OAuth defaults", () => {
    expect(getClaudeCodeOAuthModels()).toEqual([
      "claude-sonnet-4-6",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-5-20250929",
    ]);
  });

  it("preserves dynamically discovered Cursor native models and forwards an empty enabled set as-is", () => {
    const account: KeyVaultAccount = {
      id: "cursor-native-test",
      hasLocalKey: true,
      isListed: false,
      modelType: CLI_AGENT.CURSOR,
      name: "Cursor Native Test",
      status: "ready",
      hasKey: true,
      hasApiKey: true,
      hasSessionToken: true,
      canUseNativeHarness: true,
      nativeHarnessType: NATIVE_HARNESS_TYPE.CURSOR,
      enabled: true,
      availableModels: ["default", "composer-2", "claude-sonnet-4-6"],
      enabledModels: [],
    };

    const enriched = withCursorNativeModels(account);

    expect(enriched.availableModels).toEqual([
      "default",
      "composer-2",
      "claude-sonnet-4-6",
    ]);
    expect(enriched.enabledModels).toEqual([]);
  });

  it("fills saved Claude Code OAuth accounts that were stored without models", () => {
    const account: KeyVaultAccount = {
      id: "claude-code-oauth-empty-test",
      hasLocalKey: true,
      isListed: false,
      modelType: CLI_AGENT.CLAUDE_CODE,
      name: "Claude Code OAuth Empty Test",
      status: "ready",
      hasKey: true,
      hasApiKey: false,
      hasSessionToken: true,
      authMethod: "oauth",
      enabled: true,
      availableModels: [],
      enabledModels: [],
    };

    const enriched = withClaudeCodeOAuthModels(account);

    expect(enriched.availableModels).toEqual([
      "claude-sonnet-4-6",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-5-20250929",
    ]);
    expect(enriched.enabledModels).toEqual(["claude-sonnet-4-6"]);
  });

  it("unions discovered Claude Code OAuth models with the native harness catalog", () => {
    const account: KeyVaultAccount = {
      id: "claude-code-oauth-discovered-test",
      hasLocalKey: true,
      isListed: false,
      modelType: CLI_AGENT.CLAUDE_CODE,
      name: "Claude Code OAuth Discovered Test",
      status: "ready",
      hasKey: true,
      hasApiKey: false,
      hasSessionToken: true,
      authMethod: "oauth",
      enabled: true,
      availableModels: ["claude-sonnet-4-6"],
      enabledModels: ["claude-sonnet-4-6"],
    };

    const enriched = withClaudeCodeOAuthModels(account);

    expect(enriched.availableModels).toEqual([
      "claude-sonnet-4-6",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-5-20250929",
    ]);
    expect(enriched.enabledModels).toEqual(["claude-sonnet-4-6"]);
  });

  it("forwards the user-configured Cursor native enabled set unchanged", () => {
    const account: KeyVaultAccount = {
      id: "cursor-native-user-toggled",
      hasLocalKey: true,
      isListed: false,
      modelType: CLI_AGENT.CURSOR,
      name: "Cursor Native User Toggled",
      status: "ready",
      hasKey: true,
      hasApiKey: true,
      hasSessionToken: true,
      canUseNativeHarness: true,
      nativeHarnessType: NATIVE_HARNESS_TYPE.CURSOR,
      enabled: true,
      availableModels: ["composer-2", "composer-2-fast", "gpt-5.5"],
      enabledModels: ["gpt-5.5"],
    };

    const enriched = withCursorNativeModels(account);

    expect(enriched.enabledModels).toEqual(["gpt-5.5"]);
  });

  it("falls back to the Cursor native available list but leaves enabled empty when dynamic discovery is empty", () => {
    const account: KeyVaultAccount = {
      id: "cursor-native-empty-test",
      hasLocalKey: true,
      isListed: false,
      modelType: CLI_AGENT.CURSOR,
      name: "Cursor Native Empty Test",
      status: "ready",
      hasKey: true,
      hasApiKey: true,
      hasSessionToken: true,
      canUseNativeHarness: true,
      nativeHarnessType: NATIVE_HARNESS_TYPE.CURSOR,
      enabled: true,
      availableModels: [],
      enabledModels: [],
    };

    const enriched = withCursorNativeModels(account);

    expect(enriched.availableModels).toEqual(["composer-2"]);
    expect(enriched.enabledModels).toEqual([]);
  });
});
