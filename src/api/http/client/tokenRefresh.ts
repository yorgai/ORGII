import {
  getSupabaseHostedToken,
  refreshSupabaseSession,
} from "@src/api/http/auth/supabase";
import { getRefreshToken } from "@src/config/serviceAuth";
import { createLogger } from "@src/hooks/logger";

const log = createLogger("API");

const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 500;

let isRefreshingToken = false;
let refreshPromise: Promise<string | null> | null = null;

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

export async function getOrRefreshHostedToken(): Promise<string | null> {
  const token = await getSupabaseHostedToken();
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
        const tokenResponse = await refreshSupabaseSession();
        return tokenResponse.access_token;
      } catch (error) {
        lastError = error;
        log.warn(
          `Token refresh attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`,
          error
        );

        if (isAuthError(error)) {
          log.error("Auth error - refresh token is invalid");
          break;
        }

        if (isNetworkError(error) && attempt < MAX_RETRIES) {
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }

        if (!navigator.onLine) {
          log.warn("Offline - skipping further retry attempts");
          break;
        }
      }
    }

    log.error("Failed to refresh hosted-service token:", lastError);
    return null;
  })();

  refreshPromise.finally(() => {
    isRefreshingToken = false;
    refreshPromise = null;
  });

  return refreshPromise;
}
