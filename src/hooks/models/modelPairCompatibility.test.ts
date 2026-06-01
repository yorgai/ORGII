import { describe, expect, it } from "vitest";

import { CLI_AGENT } from "@src/api/types/keys";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";

import {
  isPairCompatible,
  resolveCompatibleOwnKeyAccount,
} from "./modelPairCompatibility";

function codexAccount(overrides: Partial<KeyVaultAccount>): KeyVaultAccount {
  return {
    id: "account-id",
    hasLocalKey: true,
    isListed: false,
    modelType: CLI_AGENT.CODEX,
    name: "cdx",
    status: "ready",
    hasKey: true,
    hasApiKey: false,
    hasSessionToken: true,
    authMethod: "oauth",
    enabled: true,
    availableModels: ["gpt-5.5"],
    enabledModels: ["gpt-5.5"],
    ...overrides,
  };
}

function recentPair(overrides: Partial<RecentModelEntry>): RecentModelEntry {
  return {
    modelId: "gpt-5.5",
    sourceType: "own_key",
    accountId: "old-account-id",
    accountName: "cdx1",
    modelType: CLI_AGENT.CODEX,
    ...overrides,
  };
}

describe("model pair compatibility", () => {
  it("rebinds a deleted and recreated same-name account", () => {
    const pair = recentPair({ accountId: "deleted-account-id" });
    const accounts = [
      codexAccount({ id: "be554fa5", name: "cdx1" }),
      codexAccount({ id: "66681979", name: "cdx2" }),
    ];

    const account = resolveCompatibleOwnKeyAccount(pair, accounts);

    expect(account?.id).toBe("be554fa5");
    expect(
      isPairCompatible(pair, {
        accounts,
        orgiiPoolEnabled: true,
        orgiiModelSet: new Map(),
        orgiiCategoryIds: new Set(),
      })
    ).toBe(true);
  });

  it("does not rebind to a same-name account without the selected model", () => {
    const pair = recentPair({ accountId: "deleted-account-id" });
    const accounts = [
      codexAccount({
        id: "be554fa5",
        name: "cdx1",
        enabledModels: ["gpt-5.4"],
      }),
    ];

    expect(resolveCompatibleOwnKeyAccount(pair, accounts)).toBeNull();
    expect(
      isPairCompatible(pair, {
        accounts,
        orgiiPoolEnabled: true,
        orgiiModelSet: new Map(),
        orgiiCategoryIds: new Set(),
      })
    ).toBe(false);
  });
});
