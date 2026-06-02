/**
 * Service Auth0 Configuration
 *
 * Configuration for the ORGII hosted service authentication via Auth0
 * Uses Authorization Code Flow with PKCE for secure token exchange
 * Supports refresh tokens for seamless session management
 */
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";

import { createLogger } from "@src/hooks/logger";

const logger = createLogger("PKCE");

// ============================================
// Environment Detection
// ============================================

/**
 * Check if running in Tauri production mode
 * In dev mode, we use http://localhost:1998
 * In production Tauri, we use the yorgai:// deep link protocol
 */
export const isTauriProduction = (): boolean => {
  if (typeof window === "undefined") return false;

  // In Tauri production, origin is "tauri://localhost"
  // In dev mode, origin is "http://localhost:1998"
  return window.location.origin.startsWith("tauri://");
};

/**
 * Get the appropriate callback URL based on environment
 */
export const getCallbackUrl = (): string => {
  if (isTauriProduction()) {
    // Production: use deep link protocol
    return "yorgai://marketplace/callback";
  }
  return `${window.location.origin}/orgii/marketplace/callback`;
};

// ============================================
// Auth0 Configuration
// ============================================

export const SERVICE_AUTH_CONFIG = {
  domain: "dev-pgd0s1tyuvzlxuu8.us.auth0.com",
  clientId: "EG8byVgJ3QcWat00d8MVp0pOzfXfNDJx",
  // Auth0 API identifier — must match the "identifier" registered in the Auth0 dashboard exactly (immutable).
  audience: "yorgai.marketplace",
  scope: "openid profile email offline_access",
  responseType: "code",
} as const;

// ============================================
// Storage Keys
// ============================================

export const SERVICE_AUTH_STORAGE_KEYS = {
  accessToken: "hosted_access_token",
  refreshToken: "hosted_refresh_token",
  tokenExpiry: "hosted_token_expiry",
  userId: "hosted_user_id",
  codeVerifier: "hosted_code_verifier", // For PKCE
  oauthState: "hosted_oauth_state", // For OAuth CSRF protection
  // Set when the user explicitly chooses "continue without signing in" on
  // the login page. Treated as a soft pass for AuthGuard/AuthRedirect so
  // BYOK-only users can use the app without a hosted-service account.
  authSkipped: "orgii:auth_skipped",
} as const;

// ============================================
// Auth Skip (Continue without signing in)
// ============================================

export function isAuthSkipped(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SERVICE_AUTH_STORAGE_KEYS.authSkipped) === "1";
}

export function setAuthSkipped(skipped: boolean): void {
  if (skipped) {
    localStorage.setItem(SERVICE_AUTH_STORAGE_KEYS.authSkipped, "1");
  } else {
    localStorage.removeItem(SERVICE_AUTH_STORAGE_KEYS.authSkipped);
  }
}

// ============================================
// API Configuration
// ============================================

export const HOSTED_SERVICE_API_CONFIG = {
  baseUrl: process.env.REACT_APP_MARKETPLACE_URL || "http://localhost:8001",
} as const;

// ============================================
// PKCE Helper Functions
// ============================================

/**
 * Generate a cryptographically random string for PKCE code verifier
 * Must be between 43-128 characters
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Generate code challenge from verifier using SHA-256
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Base64 URL encode (RFC 4648)
 */
function base64UrlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < buffer.byteLength; index++) {
    binary += String.fromCharCode(buffer[index]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Store PKCE code verifier for later use
 * Uses Tauri Store (persistent across app restarts)
 */
export async function storeCodeVerifier(verifier: string): Promise<void> {
  // Also store in localStorage for redundancy during dev
  localStorage.setItem(SERVICE_AUTH_STORAGE_KEYS.codeVerifier, verifier);

  try {
    const store = await load("auth-store.json");
    await store.set("code_verifier", verifier);
    await store.save();
  } catch (err) {
    logger.error("Failed to store in Tauri Store:", err);
  }
}

/**
 * Get stored code verifier (does NOT clear it)
 * Tries Tauri Store first, then localStorage as fallback
 * Call clearCodeVerifier() separately after successful token exchange
 */
export async function getCodeVerifier(): Promise<string | null> {
  try {
    const store = await load("auth-store.json");
    const storedValue = await store.get<string>("code_verifier");
    if (storedValue) {
      return storedValue;
    }
  } catch (err) {
    logger.error("Failed to get from Tauri Store:", err);
  }

  // Fallback to localStorage
  return localStorage.getItem(SERVICE_AUTH_STORAGE_KEYS.codeVerifier);
}

/**
 * Clear stored code verifier from all storage locations
 * Call this ONLY after successful token exchange
 */
export async function clearCodeVerifier(): Promise<void> {
  localStorage.removeItem(SERVICE_AUTH_STORAGE_KEYS.codeVerifier);

  try {
    const store = await load("auth-store.json");
    await store.delete("code_verifier");
    await store.save();
  } catch (err) {
    logger.error("Failed to clear from Tauri Store:", err);
  }
}

// ============================================
// OAuth State (CSRF Protection)
// ============================================

/**
 * Generate a cryptographically random `state` parameter for OAuth CSRF
 * protection. 16 random bytes → 22-char base64url (~128 bits of entropy).
 *
 * The Auth0 spec requires this to be opaque to the IdP and unguessable to
 * an attacker. Without it, an attacker who can deliver a crafted callback
 * URL (`yorgai://marketplace/callback?code=ATTACKER_CODE`) can complete
 * the OAuth flow as themselves and bind the victim's local app session
 * to the attacker's Auth0 account (login CSRF / account-mixup).
 */
export function generateOAuthState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Persist the OAuth state value across the redirect round-trip. Uses both
 * Tauri Store (survives webview context swap in production deep-link mode)
 * and localStorage (dev / fallback).
 */
export async function storeOAuthState(state: string): Promise<void> {
  localStorage.setItem(SERVICE_AUTH_STORAGE_KEYS.oauthState, state);

  try {
    const store = await load("auth-store.json");
    await store.set("oauth_state", state);
    await store.save();
  } catch (err) {
    logger.error("Failed to store oauth state in Tauri Store:", err);
  }
}

/**
 * Read back the stored state. Tries Tauri Store first, then localStorage.
 * Does NOT clear it — caller is responsible for clearing after validation.
 */
export async function getOAuthState(): Promise<string | null> {
  try {
    const store = await load("auth-store.json");
    const storedValue = await store.get<string>("oauth_state");
    if (storedValue) {
      return storedValue;
    }
  } catch (err) {
    logger.error("Failed to get oauth state from Tauri Store:", err);
  }

  return localStorage.getItem(SERVICE_AUTH_STORAGE_KEYS.oauthState);
}

/**
 * Clear stored state from all storage locations. Call after successful
 * validation (success path) or when aborting a flow due to mismatch.
 */
export async function clearOAuthState(): Promise<void> {
  localStorage.removeItem(SERVICE_AUTH_STORAGE_KEYS.oauthState);

  try {
    const store = await load("auth-store.json");
    await store.delete("oauth_state");
    await store.save();
  } catch (err) {
    logger.error("Failed to clear oauth state from Tauri Store:", err);
  }
}

/**
 * Mark an authorization code as processed to prevent duplicate handling
 */
export async function markCodeAsProcessed(code: string): Promise<void> {
  const codeHash = code.substring(0, 20); // Use first 20 chars as identifier

  localStorage.setItem("hosted_processed_code", codeHash);

  try {
    const store = await load("auth-store.json");
    await store.set("processed_code", codeHash);
    await store.save();
  } catch (err) {
    logger.error("Failed to store processed code:", err);
  }
}

/**
 * Check if an authorization code has already been processed
 */
export async function isCodeAlreadyProcessed(code: string): Promise<boolean> {
  const codeHash = code.substring(0, 20);

  // Check localStorage first
  const localProcessed = localStorage.getItem("hosted_processed_code");
  if (localProcessed === codeHash) {
    return true;
  }

  // Check Tauri Store
  try {
    const store = await load("auth-store.json");
    const storedCode = await store.get<string>("processed_code");
    if (storedCode === codeHash) {
      return true;
    }
  } catch (err) {
    logger.error("Failed to check processed code:", err);
  }

  return false;
}

/**
 * Clear the processed code marker (call on successful login or logout)
 */
export async function clearProcessedCode(): Promise<void> {
  localStorage.removeItem("hosted_processed_code");

  try {
    const store = await load("auth-store.json");
    await store.delete("processed_code");
    await store.save();
  } catch (err) {
    logger.error("Failed to clear processed code:", err);
  }
}

// ============================================
// Auth0 URL Builders
// ============================================

/**
 * Build the Auth0 login URL with PKCE + opaque state for CSRF protection.
 *
 * Both the PKCE verifier and the `state` value are persisted before the
 * redirect; AuthCallback must compare the returned `state` against the
 * stored one and reject the callback on mismatch.
 */
export async function buildAuth0LoginUrl(callbackUrl: string): Promise<string> {
  const { domain, clientId, audience, scope, responseType } =
    SERVICE_AUTH_CONFIG;

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateOAuthState();

  // Persist verifier + state for the callback round-trip. We store before
  // returning the URL so navigations cannot beat the writes.
  await storeCodeVerifier(codeVerifier);
  await storeOAuthState(state);

  const params = new URLSearchParams({
    response_type: responseType,
    client_id: clientId,
    redirect_uri: callbackUrl,
    audience: audience,
    scope: scope,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state: state,
  });

  return `https://${domain}/authorize?${params.toString()}`;
}

// ============================================
// Token Parsing
// ============================================

/**
 * Parse authorization code + state from URL query string (after Auth0
 * redirect). The `state` value is returned untouched; CSRF validation is
 * the caller's responsibility (see AuthCallback).
 */
export function parseAuth0Callback(urlSearch: string): {
  code: string | null;
  state: string | null;
  error: string | null;
} {
  const params = new URLSearchParams(urlSearch);

  const error = params.get("error");
  if (error) {
    const errorDescription = params.get("error_description");
    return {
      code: null,
      state: null,
      error: errorDescription || error,
    };
  }

  const code = params.get("code");
  const state = params.get("state");
  return {
    code,
    state,
    error: code ? null : "No authorization code in URL",
  };
}

// ============================================
// Token Storage Functions
// ============================================

/**
 * Store hosted-service tokens in localStorage
 */
export function storeHostedToken(
  accessToken: string,
  expiresIn: number,
  refreshToken?: string
): void {
  const expiryTime = Date.now() + expiresIn * 1000;

  localStorage.setItem(SERVICE_AUTH_STORAGE_KEYS.accessToken, accessToken);
  localStorage.setItem(
    SERVICE_AUTH_STORAGE_KEYS.tokenExpiry,
    expiryTime.toString()
  );

  if (refreshToken) {
    localStorage.setItem(SERVICE_AUTH_STORAGE_KEYS.refreshToken, refreshToken);
  }
}

/**
 * Get stored hosted-service access token (if valid)
 */
export function getHostedToken(): string | null {
  const token = localStorage.getItem(SERVICE_AUTH_STORAGE_KEYS.accessToken);
  const expiryStr = localStorage.getItem(SERVICE_AUTH_STORAGE_KEYS.tokenExpiry);

  if (!token || !expiryStr) {
    return null;
  }

  const expiry = parseInt(expiryStr, 10);
  if (Date.now() >= expiry) {
    // Token expired - don't clear yet, refresh token may still work
    return null;
  }

  return token;
}

/**
 * Get stored refresh token
 */
export function getRefreshToken(): string | null {
  return localStorage.getItem(SERVICE_AUTH_STORAGE_KEYS.refreshToken);
}

/**
 * Check if we have a refresh token available
 */
export function hasRefreshToken(): boolean {
  return !!getRefreshToken();
}

/**
 * Clear hosted-service tokens from storage
 */
export function clearHostedToken(): void {
  localStorage.removeItem(SERVICE_AUTH_STORAGE_KEYS.accessToken);
  localStorage.removeItem(SERVICE_AUTH_STORAGE_KEYS.refreshToken);
  localStorage.removeItem(SERVICE_AUTH_STORAGE_KEYS.tokenExpiry);
  localStorage.removeItem(SERVICE_AUTH_STORAGE_KEYS.userId);
  // Drop any pending OAuth state so the next login click starts clean.
  localStorage.removeItem(SERVICE_AUTH_STORAGE_KEYS.oauthState);
  // Legacy id_token slot — kept clearing for users upgrading from a build
  // that still wrote it.
  localStorage.removeItem("id_token");
  localStorage.removeItem("user_id");
  localStorage.removeItem("orgii-user-info");
}

/**
 * Check if user is authenticated with the hosted service
 */
export function isServiceAuthenticated(): boolean {
  // Either we have a valid access token, or we have a refresh token to get a new one
  return getHostedToken() !== null || hasRefreshToken();
}

/**
 * Get token expiry time in milliseconds
 */
export function getTokenExpiryTime(): number | null {
  const expiryStr = localStorage.getItem(SERVICE_AUTH_STORAGE_KEYS.tokenExpiry);
  if (!expiryStr) return null;
  return parseInt(expiryStr, 10);
}

/**
 * Get time until token expires (in seconds)
 */
export function getTimeUntilExpiry(): number | null {
  const expiry = getTokenExpiryTime();
  if (!expiry) return null;
  return Math.max(0, Math.floor((expiry - Date.now()) / 1000));
}

/**
 * Check if token is about to expire (within threshold)
 * @param thresholdSeconds - seconds before expiry to consider "about to expire"
 */
export function isTokenAboutToExpire(thresholdSeconds: number = 300): boolean {
  const timeLeft = getTimeUntilExpiry();
  if (timeLeft === null) return true;
  return timeLeft <= thresholdSeconds;
}

// ============================================
// Token Verification API
// ============================================

export interface TokenVerifyResponse {
  valid: boolean;
  user_id?: string;
  email?: string;
  name?: string;
  roles?: string[];
}

export async function verifyHostedToken(): Promise<TokenVerifyResponse> {
  const token = getHostedToken();

  if (!token) {
    return { valid: false };
  }

  const response = await invoke<{ status: number; data: unknown }>(
    "hosted_service_proxy",
    {
      request: {
        method: "GET",
        path: "/auth/verify",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    }
  );

  if (response.status < 200 || response.status >= 300) {
    return { valid: false };
  }

  return response.data as TokenVerifyResponse;
}
