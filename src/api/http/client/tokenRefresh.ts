/**
 * Token Refresh
 *
 * Handles hosted-service token auto-refresh logic.
 * Delegates to Rust secure storage (keychain) via secureGetAccessToken.
 */
import {
  auth0RefreshAndStore,
  secureGetAccessToken,
} from "@src/api/http/auth/secure";
import { SERVICE_AUTH_CONFIG, getRefreshToken } from "@src/config/serviceAuth";
import { createLogger } from "@src/hooks/logger";

const log = createLogger("API");

// ============================================
// Constants
// ============================================

const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 500;

// ============================================
// State
// ============================================

let isRefreshingToken = false;
let refreshPromise: Promise<string | null> | null = null;

// ============================================
// Helper Functions
// ============================================

function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("timeout") ||
      message.includes("aborted") ||
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("failed to fetch")
    );
  }
  return error instanceof TypeError;
}

function isAuthError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("invalid_grant") ||
      message.includes("refresh token") ||
      message.includes("unauthorized") ||
      message.includes("invalid token")
    );
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// Token Refresh
// ============================================

/**
 * Get hosted-service token, auto-refreshing if expired.
 *
 * In Tauri: reads from Rust keychain via secure_get_access_token; refreshes
 * via auth0_refresh_and_store (stores new tokens back to keychain).
 * In web: reads from localStorage; refreshes via direct Auth0 HTTP call.
 *
 * Prevents duplicate refresh calls via singleton promise.
 */
export async function getOrRefreshHostedToken(): Promise<string | null> {
  const token = await secureGetAccessToken();
  if (token) {
    return token;
  }

  const storedRefreshToken = getRefreshToken();
  if (!storedRefreshToken) {
    return null;
  }

  if (isRefreshingToken && refreshPromise) {
    return refreshPromise;
  }

  isRefreshingToken = true;
  refreshPromise = (async () => {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const tokenResponse = await auth0RefreshAndStore(
          SERVICE_AUTH_CONFIG.domain,
          SERVICE_AUTH_CONFIG.clientId
        );
        return tokenResponse.access_token;
      } catch (error) {
        lastError = error;
        log.warn(
          `[API] Token refresh attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`,
          error
        );

        if (isAuthError(error)) {
          log.error("[API] Auth error - refresh token is invalid");
          break;
        }

        if (isNetworkError(error) && attempt < MAX_RETRIES) {
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }

        if (!navigator.onLine) {
          log.warn("[API] Offline - skipping further retry attempts");
          break;
        }
      }
    }

    log.error("[API] Failed to refresh hosted-service token:", lastError);
    return null;
  })();

  refreshPromise.finally(() => {
    isRefreshingToken = false;
    refreshPromise = null;
  });

  return refreshPromise;
}
