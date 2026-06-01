import {
  CLI_AGENT,
  NATIVE_HARNESS_TYPE,
} from "@src/api/tauri/rpc/schemas/validation";
import type { NativeHarnessType } from "@src/api/types/keys";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";

const CLAUDE_CODE_OAUTH_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-5-20250929",
] as const;

const CLAUDE_CODE_OAUTH_DEFAULT_ENABLED_MODELS = ["claude-sonnet-4-6"] as const;

const CODEX_OAUTH_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2",
  "codex-auto-review",
] as const;

const CODEX_OAUTH_DEFAULT_ENABLED_MODELS = ["gpt-5.5"] as const;

const MY_KEY_FALLBACK_NATIVE_MODELS: Record<
  NativeHarnessType,
  readonly string[]
> = {
  [NATIVE_HARNESS_TYPE.CURSOR]: ["composer-2"],
};

export function getMyKeyFallbackNativeModels(
  nativeHarnessType: NativeHarnessType
): string[] {
  return [...MY_KEY_FALLBACK_NATIVE_MODELS[nativeHarnessType]];
}

export function getClaudeCodeOAuthModels(): string[] {
  return [...CLAUDE_CODE_OAUTH_MODELS];
}

export function getClaudeCodeOAuthDefaultEnabledModels(): string[] {
  return [...CLAUDE_CODE_OAUTH_DEFAULT_ENABLED_MODELS];
}

export function getCodexOAuthModels(): string[] {
  return [...CODEX_OAUTH_MODELS];
}

export function getCodexOAuthDefaultEnabledModels(): string[] {
  return [...CODEX_OAUTH_DEFAULT_ENABLED_MODELS];
}

export function isCursorNativeAccount(account: KeyVaultAccount): boolean {
  return (
    account.modelType === CLI_AGENT.CURSOR &&
    account.hasSessionToken &&
    account.enabled &&
    (account.canUseNativeHarness ||
      account.nativeHarnessType === NATIVE_HARNESS_TYPE.CURSOR)
  );
}

export function isClaudeCodeOAuthAccount(account: KeyVaultAccount): boolean {
  return (
    account.modelType === CLI_AGENT.CLAUDE_CODE &&
    account.hasSessionToken &&
    account.enabled &&
    account.authMethod === "oauth"
  );
}

export function isCodexOAuthAccount(account: KeyVaultAccount): boolean {
  return (
    account.modelType === CLI_AGENT.CODEX &&
    account.hasSessionToken &&
    account.enabled &&
    account.authMethod === "oauth"
  );
}

export function withCursorNativeModels(
  account: KeyVaultAccount
): KeyVaultAccount {
  // `enabledModels` is the user's source of truth and is forwarded as-is.
  // `availableModels` may be seeded from the fallback list when dynamic
  // discovery has not yet populated the account, so picker UIs always have
  // something to render.
  const availableModels = new Set(account.availableModels ?? []);

  if (availableModels.size === 0) {
    for (const modelId of getMyKeyFallbackNativeModels(
      NATIVE_HARNESS_TYPE.CURSOR
    )) {
      availableModels.add(modelId);
    }
  }

  return {
    ...account,
    status: "ready",
    canUseNativeHarness: true,
    nativeHarnessType: account.nativeHarnessType ?? NATIVE_HARNESS_TYPE.CURSOR,
    availableModels: Array.from(availableModels),
    enabledModels: account.enabledModels ?? [],
  };
}

export function withClaudeCodeOAuthModels(
  account: KeyVaultAccount
): KeyVaultAccount {
  const availableModels = new Set(account.availableModels ?? []);
  const enabledModels = new Set(account.enabledModels ?? []);

  for (const modelId of getClaudeCodeOAuthModels()) {
    availableModels.add(modelId);
  }

  if (enabledModels.size === 0) {
    for (const modelId of CLAUDE_CODE_OAUTH_DEFAULT_ENABLED_MODELS) {
      if (availableModels.has(modelId)) enabledModels.add(modelId);
    }
  }

  return {
    ...account,
    status: "ready",
    availableModels: Array.from(availableModels),
    enabledModels: Array.from(enabledModels),
  };
}

export function withCodexOAuthModels(
  account: KeyVaultAccount
): KeyVaultAccount {
  const availableModels = new Set(account.availableModels ?? []);
  const enabledModels = new Set(account.enabledModels ?? []);

  for (const modelId of getCodexOAuthModels()) {
    availableModels.add(modelId);
  }

  if (enabledModels.size === 0) {
    for (const modelId of CODEX_OAUTH_DEFAULT_ENABLED_MODELS) {
      if (availableModels.has(modelId)) enabledModels.add(modelId);
    }
  }

  return {
    ...account,
    status: "ready",
    availableModels: Array.from(availableModels),
    enabledModels: Array.from(enabledModels),
  };
}

export function withNativeHarnessModels(
  accounts: KeyVaultAccount[],
  dispatchCategory: string | null
): KeyVaultAccount[] {
  if (dispatchCategory !== "rust_agent") return accounts;
  return accounts.map((account) => {
    if (isCursorNativeAccount(account)) return withCursorNativeModels(account);
    if (isClaudeCodeOAuthAccount(account))
      return withClaudeCodeOAuthModels(account);
    if (isCodexOAuthAccount(account)) return withCodexOAuthModels(account);
    return account;
  });
}
