/**
 * Secure Auth API
 *
 * Wrapper for Rust secure authentication commands.
 * Uses system keychain for token storage:
 * - macOS: Keychain
 * - Windows: Credential Manager
 * - Linux: Secret Service
 */
import { invoke } from "@tauri-apps/api/core";

// ============================================
// Types
// ============================================

export interface AuthState {
  is_authenticated: boolean;
  access_token: string | null;
  expires_in: number | null;
  user_id: string | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

// ============================================
// Rust Command Wrappers
// ============================================

/**
 * Store tokens securely in system keychain
 */
export async function secureStoreTokens(
  accessToken: string,
  refreshToken: string | null,
  expiresIn: number,
  userId?: string
): Promise<void> {
  await invoke("secure_store_tokens", {
    accessToken,
    refreshToken,
    expiresIn,
    userId,
  });
}

/**
 * Get current authentication state from keychain
 */
export async function secureGetAuthState(): Promise<AuthState> {
  return invoke<AuthState>("secure_get_auth_state");
}

/**
 * Get access token (returns null if expired)
 */
export async function secureGetAccessToken(): Promise<string | null> {
  return invoke<string | null>("secure_get_access_token");
}

/**
 * Get refresh token from keychain
 */
export async function secureGetRefreshToken(): Promise<string | null> {
  return invoke<string | null>("secure_get_refresh_token");
}

/**
 * Check if token is about to expire
 */
export async function secureIsTokenExpiring(
  thresholdSeconds: number = 300
): Promise<boolean> {
  return invoke<boolean>("secure_is_token_expiring", { thresholdSeconds });
}

/**
 * Clear all tokens (logout)
 */
export async function secureClearTokens(): Promise<void> {
  // Clear localStorage keys that some parts of app may still read
  localStorage.removeItem("hosted_access_token");
  localStorage.removeItem("hosted_refresh_token");
  localStorage.removeItem("hosted_token_expiry");
  localStorage.removeItem("hosted_user_id");
  localStorage.removeItem("id_token");
  localStorage.removeItem("user_id");
  localStorage.removeItem("orgii-user-info");

  await invoke("secure_clear_tokens");
}

// ============================================
// Auth0 Token Exchange (via Rust)
// ============================================

/**
 * Exchange authorization code for tokens and store in keychain
 */
export async function auth0ExchangeAndStore(
  domain: string,
  clientId: string,
  code: string,
  codeVerifier: string,
  redirectUri: string,
  audience: string,
  userId?: string
): Promise<TokenResponse> {
  return invoke<TokenResponse>("auth0_exchange_and_store", {
    domain,
    clientId,
    code,
    codeVerifier,
    redirectUri,
    audience,
    userId,
  });
}

/**
 * Refresh token and store new tokens in keychain
 */
export async function auth0RefreshAndStore(
  domain: string,
  clientId: string
): Promise<TokenResponse> {
  return invoke<TokenResponse>("auth0_refresh_and_store", {
    domain,
    clientId,
  });
}

/**
 * Revoke token and clear keychain (logout)
 */
export async function auth0RevokeToken(
  domain: string,
  clientId: string
): Promise<void> {
  await invoke("auth0_revoke_token", {
    domain,
    clientId,
  });
}
