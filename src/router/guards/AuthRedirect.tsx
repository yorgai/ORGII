/**
 * AuthRedirect - Smart redirect based on authentication status
 *
 * Redirects users to the appropriate page based on their login status:
 * - Not logged in → Login page
 * - Logged in with last used repo → Start page (auto-select last repo)
 * - Logged in without last repo → Select repo page
 *
 * Note: selectedRepoIdAtom's custom storage adapter automatically restores
 * from lastUsedRepo in localStorage on app restart (when sessionStorage is empty),
 * so no manual syncing is needed here.
 */
import { useAtomValue } from "jotai";
import React from "react";
import { Navigate, useLocation } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import { isAuthSkipped } from "@src/config/serviceAuth";
import { useServiceAuthState } from "@src/hooks/auth";
import { lastUsedRepoAtom } from "@src/store/repo";

/**
 * AuthRedirect Component
 * Used for the root index route to determine initial navigation
 */
export const AuthRedirect: React.FC = () => {
  const { isAuthenticated } = useServiceAuthState();
  const location = useLocation();
  const lastUsedRepo = useAtomValue(lastUsedRepoAtom);

  // Check if user was redirected here with a specific destination
  const from = (location.state as { from?: { pathname: string } })?.from
    ?.pathname;

  // BYOK-only users may have skipped login — treat that as authorized for
  // routing purposes. AuthGuard does the same check.
  if (!isAuthenticated && !isAuthSkipped()) {
    return <Navigate to={ROUTES.auth.login.path} replace />;
  }

  if (lastUsedRepo) {
    return <Navigate to={ROUTES.app.home.start.path} replace />;
  }

  const destination = from || ROUTES.app.home.selectRepo.path;
  return <Navigate to={destination} replace />;
};
