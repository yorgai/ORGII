/**
 * Auth0 Token Exchange API
 *
 * Handles OAuth token exchange and refresh for Auth0 PKCE flow.
 * This file manages the frontend-side token operations.
 *
 * Flow:
 * 1. User completes Auth0 login, gets authorization code
 * 2. Frontend exchanges code for tokens (access + refresh)
 * 3. When access token expires, use refresh token to get new one
 *
 * In Tauri production mode, token exchange is handled via Rust commands
 * to bypass CORS restrictions (tauri://localhost origin is not allowed by Auth0).
 */
import {
  SERVICE_AUTH_CONFIG,
  getCallbackUrl,
  isTauriProduction,
  storeHostedToken,
} from "@src/config/serviceAuth";
import { createLogger } from "@src/hooks/logger";

const log = createLogger("Auth0Token");

// ============================================
// Types
// ============================================

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface TokenError {
  error: string;
  error_description?: string;
}

// ============================================
// Token Exchange (Authorization Code → Tokens)
// ============================================

/**
 * Exchange authorization code for tokens using PKCE
 * Uses Tauri Rust command in production to bypass CORS
 *
 * @param code - The authorization code from Auth0 callback
 * @param codeVerifier - The PKCE code verifier stored during login
 * @returns Token response or throws error
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<TokenResponse> {
  const { domain, clientId, audience } = SERVICE_AUTH_CONFIG;
  const redirectUri = getCallbackUrl();

  let tokenData: TokenResponse;

  // In Tauri production, use Rust command to bypass CORS
  if (isTauriProduction()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      tokenData = await invoke<TokenResponse>("auth0_exchange_code", {
        domain,
        clientId,
        code,
        codeVerifier,
        redirectUri,
        audience,
      });
    } catch (err) {
      log.error("[Auth0Token] Tauri token exchange failed:", err);
      throw new Error(
        typeof err === "string" ? err : "Token exchange failed via Tauri"
      );
    }
  } else {
    // In dev/web mode, use fetch
    const tokenEndpoint = `https://${domain}/oauth/token`;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      audience: audience,
    });

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorData = data as TokenError;
      log.error("[Auth0Token] Token exchange failed:", errorData);
      throw new Error(
        errorData.error_description ||
          errorData.error ||
          "Token exchange failed"
      );
    }

    tokenData = data as TokenResponse;
  }

  // Store tokens
  storeHostedToken(
    tokenData.access_token,
    tokenData.expires_in,
    tokenData.refresh_token
  );

  return tokenData;
}

// ============================================
// Token Refresh
// ============================================

/**
 * Refresh access token using refresh token
 * Uses Tauri Rust command in production to bypass CORS
 *
 * @param refreshToken - The stored refresh token
 * @returns New token response or throws error
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenResponse> {
  const { domain, clientId } = SERVICE_AUTH_CONFIG;

  let tokenData: TokenResponse;

  // In Tauri production, use Rust command to bypass CORS
  if (isTauriProduction()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      tokenData = await invoke<TokenResponse>("auth0_refresh_token", {
        domain,
        clientId,
        refreshToken,
      });
    } catch (err) {
      log.error("[Auth0Token] Tauri token refresh failed:", err);
      throw new Error(
        typeof err === "string" ? err : "Token refresh failed via Tauri"
      );
    }
  } else {
    // In dev/web mode, use fetch
    const tokenEndpoint = `https://${domain}/oauth/token`;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    });

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorData = data as TokenError;
      log.error("[Auth0Token] Token refresh failed:", errorData);
      throw new Error(
        errorData.error_description || errorData.error || "Token refresh failed"
      );
    }

    tokenData = data as TokenResponse;
  }

  // Store new tokens (Auth0 may issue a new refresh token with rotation)
  storeHostedToken(
    tokenData.access_token,
    tokenData.expires_in,
    tokenData.refresh_token // May be new if rotation is enabled
  );

  return tokenData;
}

// ============================================
// Token Revocation (Logout)
// ============================================

/**
 * Revoke refresh token on logout (optional but recommended)
 *
 * @param refreshToken - The refresh token to revoke
 */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const { domain, clientId } = SERVICE_AUTH_CONFIG;

  const revokeEndpoint = `https://${domain}/oauth/revoke`;

  const body = new URLSearchParams({
    client_id: clientId,
    token: refreshToken,
  });

  try {
    const response = await fetch(revokeEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (response.ok) {
      // Token revoked successfully - no action needed
    } else {
      log.warn(
        "[Auth0Token] Token revocation returned non-OK status:",
        response.status
      );
    }
  } catch (error) {
    // Don't throw on revocation failure - user is logging out anyway
    log.warn("[Auth0Token] Token revocation failed:", error);
  }
}

// ============================================
// Exports
// ============================================

export const auth0TokenApi = {
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeRefreshToken,
};

export default auth0TokenApi;
