/**
 * AuthRedirect - Smart redirect based on authentication status
 *
 * Redirects users to the appropriate page based on their login status:
 * - Not logged in → Login page
 * - Logged in → WorkStation
 *
 * Repo selection is restored by RepoLoader/useRepoLoader from the current
 * window state, the last-used repo, cached recent repos, or the first repo.
 */
import React from "react";
import { Navigate } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import { isAuthSkipped } from "@src/config/serviceAuth";
import { useServiceAuthState } from "@src/hooks/auth";

/**
 * AuthRedirect Component
 * Used for the root index route to determine initial navigation
 */
export const AuthRedirect: React.FC = () => {
  const { isAuthenticated } = useServiceAuthState();

  // BYOK-only users may have skipped login — treat that as authorized for
  // routing purposes. AuthGuard does the same check.
  if (!isAuthenticated && !isAuthSkipped()) {
    return <Navigate to={ROUTES.auth.login.path} replace />;
  }

  return <Navigate to={ROUTES.workStation.base.path} replace />;
};
