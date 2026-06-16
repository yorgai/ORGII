import { getDefaultStore } from "jotai";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { exchangeSupabaseCodeForSession } from "@src/api/http/auth/supabase";
import { ROUTES } from "@src/config/routes";
import {
  SERVICE_AUTH_STORAGE_KEYS,
  clearProcessedCode,
  isCodeAlreadyProcessed,
  markCodeAsProcessed,
  parseAuthCallback,
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

    const redirectToLogin = () => {
      safeTimeout(() => {
        navigate(ROUTES.auth.login.path, { replace: true });
      }, 2000);
    };

    const handleCallback = async () => {
      if (isProcessingRef.current) {
        return;
      }

      const search = location.search;

      if (!search) {
        log.error("No query params found in URL");
        setError(t("market.auth.noAuthCode"));
        redirectToLogin();
        return;
      }

      const result = parseAuthCallback(search);

      if (result.error) {
        log.error("Supabase auth error:", result.error);
        setError(result.error);
        redirectToLogin();
        return;
      }

      if (!result.code) {
        log.error("No authorization code in response");
        setError(t("market.auth.noAuthCode"));
        redirectToLogin();
        return;
      }

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

      isProcessingRef.current = true;

      try {
        await markCodeAsProcessed(result.code);

        const tokenResponse = await exchangeSupabaseCodeForSession(result.code);

        const store = getDefaultStore();
        store.set(serviceAuthAtom, true);
        store.set(hostedTokenAtom, tokenResponse.access_token);
        store.set(serviceExpiryAtom, tokenResponse.expires_in);
        store.set(serviceValidatedAtom, true);

        window.dispatchEvent(new Event("localStorageChange"));

        await clearProcessedCode();

        const storedRedirect = sessionStorage.getItem("login_redirect");
        sessionStorage.removeItem("login_redirect");
        const redirectPath = storedRedirect || ROUTES.app.home.start.path;
        navigate(redirectPath, { replace: true });
      } catch (exchangeError) {
        log.error("Token exchange failed:", exchangeError);
        const errorMessage =
          exchangeError instanceof Error
            ? exchangeError.message
            : t("market.auth.tokenExchangeFailed");
        setError(errorMessage);
        redirectToLogin();
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
