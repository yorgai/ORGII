/**
 * Auth0 Callback Page
 *
 * Handles the OAuth callback from Auth0 after a successful login. Renders
 * the login page's loading UI while processing the token exchange.
 *
 * Flow:
 *   1. Auth0 redirects here with an authorization code in URL query params.
 *   2. Retrieve the stored PKCE code verifier.
 *   3. Exchange code + verifier for tokens (access + refresh).
 *   4. Store tokens, hydrate Jotai atoms, redirect to home/intended destination.
 */
import { getDefaultStore } from "jotai";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { auth0ExchangeAndStore } from "@src/api/http/auth";
import { ROUTES } from "@src/config/routes";
import {
  SERVICE_AUTH_CONFIG,
  SERVICE_AUTH_STORAGE_KEYS,
  clearCodeVerifier,
  clearOAuthState,
  clearProcessedCode,
  getCallbackUrl,
  getCodeVerifier,
  getOAuthState,
  isCodeAlreadyProcessed,
  markCodeAsProcessed,
  parseAuth0Callback,
  storeHostedToken,
} from "@src/config/serviceAuth";
import {
  hostedTokenAtom,
  serviceAuthAtom,
  serviceExpiryAtom,
  serviceValidatedAtom,
} from "@src/hooks/auth";
import { createLogger } from "@src/hooks/logger";

import { LoginLoadingState } from "./index";

const log = createLogger("AuthCallback");

interface DecodedUserInfo {
  userId: string;
  email?: string;
  name?: string;
}

function extractUserFromToken(token: string): DecodedUserInfo | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payload = parts[1];
    const paddedPayload = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(
      atob(paddedPayload.replace(/-/g, "+").replace(/_/g, "/"))
    ) as { sub?: string; email?: string; name?: string; nickname?: string };

    if (!decoded.sub) return null;

    return {
      userId: decoded.sub,
      email: decoded.email,
      name: decoded.name || decoded.nickname,
    };
  } catch (error) {
    log.error("[AuthCallback] Failed to decode token:", error);
    return null;
  }
}

/** Convert Auth0 sub (e.g. "auth0|abc123") to a deterministic UUID-shaped string. */
function auth0SubToUuid(sub: string): string {
  let hash = 0;
  for (let index = 0; index < sub.length; index++) {
    const char = sub.charCodeAt(index);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }

  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(1, 4)}-${hex.padEnd(12, "0").slice(0, 12)}`;
}

const AuthCallback: React.FC = () => {
  const { t } = useTranslation("market");
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const safeTimeout = (fn: () => void, ms: number) => {
      const timer = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
      timers.push(timer);
    };

    const handleCallback = async () => {
      // Deep link may fire the listener multiple times for the same URL.
      if (isProcessingRef.current) {
        return;
      }

      const search = location.search;

      if (!search) {
        log.error("[AuthCallback] No query params found in URL");
        setError(t("market.auth.noAuthCode"));
        safeTimeout(() => {
          navigate(ROUTES.auth.login.path, { replace: true });
        }, 2000);
        return;
      }

      const result = parseAuth0Callback(search);

      if (result.error) {
        log.error("[AuthCallback] Auth0 error:", result.error);
        setError(result.error);
        safeTimeout(() => {
          navigate(ROUTES.auth.login.path, { replace: true });
        }, 2000);
        return;
      }

      if (!result.code) {
        log.error("[AuthCallback] No authorization code in response");
        setError(t("market.auth.noAuthCode"));
        safeTimeout(() => {
          navigate(ROUTES.auth.login.path, { replace: true });
        }, 2000);
        return;
      }

      // Deep-link plugin can fire the same URL multiple times; if we
      // already consumed this code (success path), short-circuit before
      // touching the single-use state value. The token is already stored.
      const alreadyProcessed = await isCodeAlreadyProcessed(result.code);
      if (cancelled) return;
      if (alreadyProcessed) {
        const existingToken = localStorage.getItem(
          SERVICE_AUTH_STORAGE_KEYS.accessToken
        );
        if (existingToken) {
          const storedRedirect = sessionStorage.getItem("login_redirect");
          sessionStorage.removeItem("login_redirect");
          const redirectPath = storedRedirect || ROUTES.app.home.start.path;
          navigate(redirectPath, { replace: true });
        }
        return;
      }

      // CSRF protection: validate the opaque state parameter against what
      // we persisted in buildAuth0LoginUrl. A missing or mismatched state
      // means this callback was not initiated by this app instance — could
      // be a forged callback URL or stale tab from a different login click.
      // Reject without consuming the code.
      const expectedState = await getOAuthState();
      if (cancelled) return;
      if (!expectedState || !result.state || result.state !== expectedState) {
        log.error("[AuthCallback] OAuth state mismatch — rejecting callback", {
          hasExpected: !!expectedState,
          hasReceived: !!result.state,
          matches: result.state === expectedState,
        });
        await clearOAuthState();
        setError(t("market.auth.authSessionExpired"));
        safeTimeout(() => {
          navigate(ROUTES.auth.login.path, { replace: true });
        }, 2000);
        return;
      }
      // Single-use: consume state now that we've verified this is our own
      // pending login. Any subsequent callback (replay, second tab) will
      // hit the alreadyProcessed early-return above instead.
      await clearOAuthState();

      isProcessingRef.current = true;

      const codeVerifier = await getCodeVerifier();
      if (cancelled) return;

      if (!codeVerifier) {
        log.error("[AuthCallback] No code verifier found - PKCE flow broken");
        setError(t("market.auth.authSessionExpired"));
        safeTimeout(() => {
          navigate(ROUTES.auth.login.path, { replace: true });
        }, 2000);
        return;
      }

      try {
        await markCodeAsProcessed(result.code);

        const tokenResponse = await auth0ExchangeAndStore(
          SERVICE_AUTH_CONFIG.domain,
          SERVICE_AUTH_CONFIG.clientId,
          result.code,
          codeVerifier,
          getCallbackUrl(),
          SERVICE_AUTH_CONFIG.audience,
          undefined
        );

        await clearCodeVerifier();

        storeHostedToken(
          tokenResponse.access_token,
          tokenResponse.expires_in,
          tokenResponse.refresh_token
        );

        // AuthGuard reads atoms synchronously after navigation; hydrate them
        // before redirect to avoid a flicker back to /login.
        const store = getDefaultStore();
        store.set(serviceAuthAtom, true);
        store.set(hostedTokenAtom, tokenResponse.access_token);
        store.set(serviceExpiryAtom, tokenResponse.expires_in);
        store.set(serviceValidatedAtom, true);

        window.dispatchEvent(new Event("localStorageChange"));

        const userInfo = extractUserFromToken(tokenResponse.access_token);
        try {
          const userUuid = userInfo?.userId
            ? auth0SubToUuid(userInfo.userId)
            : crypto.randomUUID();

          if (userInfo?.userId) {
            localStorage.setItem(
              SERVICE_AUTH_STORAGE_KEYS.userId,
              userInfo.userId
            );
            localStorage.setItem("user_id", userUuid);
            window.dispatchEvent(new Event("localStorageChange"));
          }
        } catch (profileError) {
          log.warn("[AuthCallback] Failed to persist user info:", profileError);
        }

        await clearProcessedCode();

        const storedRedirect = sessionStorage.getItem("login_redirect");
        sessionStorage.removeItem("login_redirect");
        const redirectPath = storedRedirect || ROUTES.app.home.start.path;
        navigate(redirectPath, { replace: true });
      } catch (exchangeError) {
        log.error("[AuthCallback] Token exchange failed:", exchangeError);
        const errorMessage =
          exchangeError instanceof Error
            ? exchangeError.message
            : t("market.auth.tokenExchangeFailed");
        setError(errorMessage);

        // Keep the processed-code marker on failure so we don't retry the
        // same invalid code; the verifier stays so a retry attempt with a
        // fresh code from a new login click can succeed.
        safeTimeout(() => {
          navigate(ROUTES.auth.login.path, { replace: true });
        }, 2000);
      }
    };

    handleCallback();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [location.search, navigate, t]);

  return <LoginLoadingState error={error} />;
};

export default AuthCallback;
