/**
 * RepoGuard - Requires a repo to be selected
 *
 * Redirects users to the select-repo page if no repo is selected.
 * This ensures users must select a project before using the app.
 */
import { useAtomValue } from "jotai";
import React from "react";
import { Navigate, useLocation } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import { selectedRepoIdAtom } from "@src/store/repo";

/**
 * Paths that don't require a repo to be selected
 */
function isRepoExemptPath(pathname: string): boolean {
  // Select repo page itself (should not hit this since it's outside AppShell)
  if (pathname.includes("/select-repo")) return true;
  // Login/auth routes
  if (pathname.includes("/login")) return true;
  if (pathname.includes("/setup")) return true;
  if (pathname.includes("/callback")) return true;
  // Settings can be accessed without a repo
  if (pathname.includes("/settings")) return true;
  // Market/profile can be accessed without a repo
  if (pathname.includes("/market")) return true;
  // Root path (handled by AuthRedirect)
  if (pathname === "/") return true;
  return false;
}

interface RepoGuardProps {
  children: React.ReactNode;
}

/**
 * RepoGuard Component
 *
 * Wraps children and blocks access when no repo is selected.
 * Returns Navigate to redirect, or children if repo is selected.
 */
export const RepoGuard: React.FC<RepoGuardProps> = ({ children }) => {
  const selectedRepoId = useAtomValue(selectedRepoIdAtom);
  const location = useLocation();

  // Skip repo check for exempt paths
  if (isRepoExemptPath(location.pathname)) {
    return <>{children}</>;
  }

  // If no repo selected, redirect to select-repo page
  if (!selectedRepoId) {
    return (
      <Navigate
        to={ROUTES.app.home.selectRepo.path}
        replace
        state={{ from: location }}
      />
    );
  }

  // Repo selected - render children
  return <>{children}</>;
};
