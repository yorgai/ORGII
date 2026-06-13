/**
 * useServiceAuth Hook
 *
 * Handles Auth0 authentication for the ORGII hosted service
 * Uses Authorization Code Flow with PKCE and refresh tokens
 *
 * Features:
 * - Automatic token refresh before expiry
 * - Seamless session management with refresh tokens
 * - Global state sharing via Jotai atoms
 *
 * @example
 * const { isAuthenticated, login, logout, token } = useServiceAuth();
 */
import { useAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  auth0RefreshAndStore,
  auth0RevokeToken,
  secureClearTokens,
} from "@src/api/http/auth/secure";
import { AUTH_ROUTES } from "@src/config/routes";
import {
  SERVICE_AUTH_CONFIG,
  buildAuth0LoginUrl,
  clearCodeVerifier,
  clearHostedToken,
  clearProcessedCode,
  getCallbackUrl,
  getHostedToken,
  getTimeUntilExpiry,
  hasRefreshToken,
  isServiceAuthenticated,
  isTauriProduction,
  isTokenAboutToExpire,
  setAuthSkipped,
  storeHostedToken,
  verifyHostedToken,
} from "@src/config/serviceAuth";
import { createLogger } from "@src/hooks/logger";

import {
  hostedTokenAtom,
  serviceAuthAtom,
  serviceErrorAtom,
  serviceExpiryAtom,
  serviceLoadingAtom,
  serviceRefreshingAtom,
  serviceValidatedAtom,
} from "./serviceAuthAtoms";
import {
  isAuthError,
  isNetworkError,
  isNoRefreshTokenError,
  sleep,
} from "./serviceAuthHelpers";

// Re-export atoms and helpers for backward compatibility
export {
  clearAuthStateCompletely,
  serviceAuthAtom,
  serviceErrorAtom,
  serviceExpiryAtom,
  serviceLoadingAtom,
  serviceRefreshingAtom,
  hostedTokenAtom,
  serviceValidatedAtom,
  useServiceAuthState,
} from "./serviceAuthAtoms";
export type { UseServiceAuthStateReturn } from "./serviceAuthAtoms";

const logger = createLogger("ServiceAuth");

const REFRESH_THRESHOLD_SECONDS = 300;
const EXPIRY_CHECK_INTERVAL_MS = 30000;
const MAX_REFRESH_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const VISIBILITY_CHANGE_DEBOUNCE_MS = 500;
const VISIBILITY_VERIFY_MIN_INTERVAL_MS = 3 * 60 * 1000;
let lastVisibilityVerifyAt = 0;

/** Global guard: prevents concurrent refresh calls across all hook instances */
let globalRefreshInProgress = false;

export interface UseServiceAuthReturn {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  expiresIn: number | null;
  error: string | null;
  isRefreshing: boolean;
  login: () => void;
  logout: (options?: { redirect?: boolean }) => void;
  refresh: () => void;
  refreshToken: () => Promise<boolean>;
}

/**
 * Full hook with side effects and actions.
 * Use ONLY in components that need login/logout/refresh.
 * Runs validation, expiry timer, and visibility listener.
 */
export function useServiceAuth(): UseServiceAuthReturn {
  const location = useLocation();
  const navigate = useNavigate();

  const [isAuthenticated, setIsAuthenticated] = useAtom(serviceAuthAtom);
  const [isLoading, setIsLoading] = useAtom(serviceLoadingAtom);
  const [token, setToken] = useAtom(hostedTokenAtom);
  const [expiresIn, setExpiresIn] = useAtom(serviceExpiryAtom);
  const [error, setError] = useAtom(serviceErrorAtom);
  const [hasValidated, setHasValidated] = useAtom(serviceValidatedAtom);
  const [isRefreshing, setIsRefreshing] = useAtom(serviceRefreshingAtom);

  // ── Token Refresh (with retry logic) ─────────────────────────────────────
  const refreshToken = useCallback(async (): Promise<boolean> => {
    if (globalRefreshInProgress) return false;

    globalRefreshInProgress = true;
    setIsRefreshing(true);

    let lastError: unknown = null;

    for (let attempt = 0; attempt < MAX_REFRESH_RETRIES; attempt++) {
      try {
        const tokenResponse = await auth0RefreshAndStore(
          SERVICE_AUTH_CONFIG.domain,
          SERVICE_AUTH_CONFIG.clientId
        );

        setToken(tokenResponse.access_token);
        setExpiresIn(tokenResponse.expires_in);
        setIsAuthenticated(true);
        setError(null);

        storeHostedToken(
          tokenResponse.access_token,
          tokenResponse.expires_in,
          tokenResponse.refresh_token
        );

        window.dispatchEvent(new Event("localStorageChange"));

        globalRefreshInProgress = false;
        setIsRefreshing(false);
        return true;
      } catch (refreshError) {
        lastError = refreshError;

        if (isNoRefreshTokenError(refreshError)) {
          globalRefreshInProgress = false;
          setIsRefreshing(false);
          return false;
        }

        logger.warn(
          `[ServiceAuth] Token refresh attempt ${attempt + 1}/${MAX_REFRESH_RETRIES} failed:`,
          refreshError
        );

        if (isAuthError(refreshError)) {
          logger.error("Auth error - refresh token is invalid");
          break;
        }

        if (isNetworkError(refreshError) && attempt < MAX_REFRESH_RETRIES - 1) {
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }

        if (!navigator.onLine) {
          logger.warn("Offline - keeping session alive without refresh");
          globalRefreshInProgress = false;
          setIsRefreshing(false);
          return false;
        }
      }
    }

    logger.error("Token refresh failed after all retries");

    if (isAuthError(lastError)) {
      await secureClearTokens();
      clearHostedToken();
      setToken(null);
      setIsAuthenticated(false);
      setExpiresIn(null);
      setError("Session expired. Please log in again.");
    } else if (isNoRefreshTokenError(lastError)) {
      // No refresh token - user simply isn't logged in
    } else if (!navigator.onLine) {
      logger.warn("Offline after retries - keeping session");
    } else {
      logger.warn("Network issues - keeping session, will retry later");
      setError("Unable to refresh session. Will retry automatically.");
    }

    globalRefreshInProgress = false;
    setIsRefreshing(false);
    return false;
  }, [setIsRefreshing, setToken, setExpiresIn, setIsAuthenticated, setError]);

  // ── Refresh auth state from storage ──────────────────────────────────────
  const refresh = useCallback(() => {
    const storedToken = getHostedToken();
    const authenticated = isServiceAuthenticated();
    const timeLeft = getTimeUntilExpiry();

    setToken(storedToken);
    setIsAuthenticated(authenticated);
    setExpiresIn(timeLeft);
    setIsLoading(false);

    if (!storedToken && !authenticated) {
      setToken(null);
      setExpiresIn(null);
    }
  }, [setToken, setIsAuthenticated, setExpiresIn, setIsLoading]);

  // ── Validate token on mount ───────────────────────────────────────────────
  useEffect(() => {
    if (hasValidated) return;

    const storedToken = getHostedToken();
    const hasRefresh = hasRefreshToken();

    if (!storedToken && !hasRefresh) {
      setIsAuthenticated(false);
      setToken(null);
      setExpiresIn(null);
      setHasValidated(true);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const timeoutMs = 10000;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (storedToken) {
      const timeoutPromise = new Promise<{ valid: boolean }>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("Token validation timeout"));
        }, timeoutMs);
      });

      Promise.race([verifyHostedToken(), timeoutPromise])
        .then((result) => {
          clearTimeout(timeoutId);
          if (cancelled) return;
          if (result.valid) {
            setIsAuthenticated(true);
            setToken(storedToken);
            setExpiresIn(getTimeUntilExpiry());
          } else if (hasRefresh) {
            return refreshToken();
          } else {
            clearHostedToken();
            setToken(null);
            setIsAuthenticated(false);
          }
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          if (cancelled) return;
          logger.warn("Token validation failed:", err);
          setIsAuthenticated(!!storedToken);
          setToken(storedToken);
        })
        .finally(() => {
          if (cancelled) return;
          setHasValidated(true);
          setIsLoading(false);
        });
    } else if (hasRefresh) {
      refreshToken().finally(() => {
        if (cancelled) return;
        setHasValidated(true);
        setIsLoading(false);
      });
    }

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
  }, [
    hasValidated,
    setHasValidated,
    setIsLoading,
    setIsAuthenticated,
    setToken,
    setExpiresIn,
    refreshToken,
  ]);

  // ── Refresh on route changes ──────────────────────────────────────────────
  useEffect(() => {
    if (!hasValidated) return;
    refresh();
  }, [location.pathname, refresh, hasValidated]);

  // ── Login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async () => {
    // User is opting in to a real account; clear any prior "skipped" flag
    // so that on a successful sign-in the BYOK-only soft-pass goes away.
    setAuthSkipped(false);

    const callbackUrl = getCallbackUrl();
    const loginUrl = await buildAuth0LoginUrl(callbackUrl);

    if (isTauriProduction()) {
      try {
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(loginUrl);
      } catch (err) {
        logger.error("Failed to open browser:", err);
        window.open(loginUrl, "_blank");
      }
    } else {
      window.location.href = loginUrl;
    }
  }, []);

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(
    async (options: { redirect?: boolean } = { redirect: true }) => {
      try {
        await auth0RevokeToken(
          SERVICE_AUTH_CONFIG.domain,
          SERVICE_AUTH_CONFIG.clientId
        );
      } catch (revokeError) {
        logger.warn("Token revocation failed:", revokeError);
      }
      await secureClearTokens().catch(() => {});

      clearHostedToken();
      setToken(null);
      setIsAuthenticated(false);
      setExpiresIn(null);
      setError(null);

      // Logout is an explicit choice — drop any prior soft-pass so the user
      // sees the login screen again on next protected route hit.
      setAuthSkipped(false);

      await Promise.all([
        clearProcessedCode().catch(() => {}),
        clearCodeVerifier().catch(() => {}),
      ]);

      if (options.redirect) {
        navigate(AUTH_ROUTES.login.path, { replace: true });
      }
    },
    [setToken, setIsAuthenticated, setExpiresIn, setError, navigate]
  );

  // ── Auto-refresh & visibility re-validate ─────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;

    const checkAndRefresh = async () => {
      if (!navigator.onLine) return;
      if (isTokenAboutToExpire(REFRESH_THRESHOLD_SECONDS)) {
        if (hasRefreshToken()) await refreshToken();
      }
      const timeLeft = getTimeUntilExpiry();
      setExpiresIn(timeLeft);
    };

    checkAndRefresh();
    const interval = setInterval(checkAndRefresh, EXPIRY_CHECK_INTERVAL_MS);

    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(async () => {
        if (!navigator.onLine) return;
        if (isTokenAboutToExpire(REFRESH_THRESHOLD_SECONDS)) {
          await refreshToken();
        } else if (
          Date.now() - lastVisibilityVerifyAt >=
          VISIBILITY_VERIFY_MIN_INTERVAL_MS
        ) {
          try {
            lastVisibilityVerifyAt = Date.now();
            const result = await verifyHostedToken();
            if (!result.valid && hasRefreshToken()) {
              await refreshToken();
            }
          } catch (verifyError) {
            if (isNetworkError(verifyError)) {
              logger.warn(
                "Verify unreachable on visibility change, keeping session"
              );
            } else if (hasRefreshToken()) {
              await refreshToken();
            }
          }
        }
      }, VISIBILITY_CHANGE_DEBOUNCE_MS);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      if (debounceTimeout) clearTimeout(debounceTimeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isAuthenticated, setExpiresIn, refreshToken]);

  return {
    isAuthenticated,
    isLoading,
    token,
    expiresIn,
    error,
    isRefreshing,
    login,
    logout,
    refresh,
    refreshToken,
  };
}

export default useServiceAuth;
