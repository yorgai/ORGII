/**
 * Key resolution
 *
 * For own_key: Extracts model + accountId directly from advancedConfig.
 * For hosted_key: Validates auth, returns the ORGII-hosted key.
 */
import { getOrRefreshHostedToken } from "@src/api/http/client/tokenRefresh";
import type {
  CliAgentType,
  NativeHarnessType,
} from "@src/api/tauri/rpc/schemas/validation";
import { KEY_SOURCE, isHostedKey } from "@src/api/tauri/session";
import { Message } from "@src/components/Message";
import type {
  AdvancedConfig,
  KeySource,
} from "@src/features/SessionCreator/types";

// ============================================
// Types
// ============================================
//
// NOTE: The session creator validates that an own-key session has either
// a saved account, a CLI agent type, or a provider before reaching here
// (see useSessionValidation). resolveOwnKey is the last line of defense
// against shipping a launch RPC with no key info at all.

// ============================================
// Types
// ============================================

export interface ResolvedKeys {
  model: string | undefined;
  accountId: string | undefined;
  cliAgentType: CliAgentType | undefined;
  nativeHarnessType: NativeHarnessType | undefined;
  branch: string | undefined;
  keySource: KeySource;
  hostedToken?: string;
  tier?: string;
}

export interface KeyCallbacks {
  onAuthError: () => void;
}

// ============================================
// Own key — simple field extraction
// ============================================

function resolveOwnKey(advancedConfig: AdvancedConfig): ResolvedKeys | null {
  const accountId = advancedConfig.selectedAccountId || undefined;
  const cliAgentType = advancedConfig.cliAgentType || undefined;
  const provider = advancedConfig.provider || undefined;

  if (!accountId && !cliAgentType && !provider) {
    Message.error({
      content: "Please select a model and source before launching",
      duration: 3000,
    });
    return null;
  }

  return {
    model: advancedConfig.model || undefined,
    accountId,
    cliAgentType,
    nativeHarnessType: advancedConfig.nativeHarnessType,
    branch: advancedConfig.branch,
    keySource: KEY_SOURCE.OWN,
  };
}

// ============================================
// Hosted key session resolution
// ============================================

async function resolveHostedKey(
  advancedConfig: AdvancedConfig,
  callbacks: KeyCallbacks
): Promise<ResolvedKeys | null> {
  if (!advancedConfig.cliAgentType) {
    Message.error({
      content: "Please select an agent from the model selector",
      duration: 3000,
    });
    return null;
  }

  const token = await getOrRefreshHostedToken();
  if (!token) {
    callbacks.onAuthError();
    return null;
  }

  return {
    model: advancedConfig.listingModel || undefined,
    accountId: undefined,
    cliAgentType: advancedConfig.cliAgentType,
    nativeHarnessType: undefined,
    branch: advancedConfig.branch,
    keySource: KEY_SOURCE.HOSTED,
    hostedToken: token,
    tier: advancedConfig.tier || undefined,
  };
}

// ============================================
// Public API
// ============================================

export async function resolveKeys(
  keySource: KeySource,
  advancedConfig: AdvancedConfig,
  callbacks: KeyCallbacks
): Promise<ResolvedKeys | null> {
  if (isHostedKey(keySource)) {
    return resolveHostedKey(advancedConfig, callbacks);
  }
  return resolveOwnKey(advancedConfig);
}
