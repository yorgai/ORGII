/**
 * Authentication API Endpoints
 *
 * Handles user authentication, authorization, and profile management.
 *
 * Base URLs:
 * - /api/v2/login - Authentication endpoints
 * - /api/v2/user - User profile endpoints
 */
import { ISetUserAPIKeyParam, IUserInfo } from "@src/types/core/user";

import { getApi, postApi } from "../client";

// ============================================
// Authentication Endpoints
// ============================================

const LOGIN_URL = "/api/v2/login";
const USER_URL = "/api/v2/user";

/**
 * Get login URL for OAuth flow
 */
export async function getLoginUrl() {
  return getApi<{ url: string }>(LOGIN_URL + "/url");
}

/**
 * Complete login with OAuth code
 */
export async function completeLogin(params: { code: string }) {
  return postApi<{
    user: IUserInfo;
    id_token: string;
  }>(LOGIN_URL + "/complete", params);
}

// ============================================
// User Profile Endpoints
// ============================================

/**
 * Get current user info
 */
export async function getCurrentUserInfo() {
  return getApi<{
    user_public: IUserInfo;
    github_token: string;
    access_token: string;
  }>(USER_URL + "/me", {}, true);
}

/**
 * Get user info by Authing ID
 */
export async function getUserInfoByAuthingId(params: { authing_id: string }) {
  return getApi<IUserInfo>(
    USER_URL + "/get_user_info_by_authing_id",
    params,
    true
  );
}

// ============================================
// Git Account Management
// ============================================

/**
 * Delete GitHub account
 */
export async function deleteGitHubAccount(params: {
  user_id: string;
  github_info_uuid: string;
}) {
  return postApi<void>(USER_URL + "/delete_github_info", params, true);
}

/**
 * Delete GitLab account
 */
export async function deleteGitLabAccount(params: {
  user_id: string;
  gitlab_info_uuid: string;
}) {
  return postApi<void>(USER_URL + "/delete_gitlab_info", params, true);
}

/**
 * Add GitHub classic token
 */
export async function addGitHubClassicToken(params: {
  user_id: string;
  user_name: string;
  token: string;
}) {
  return postApi<void>(USER_URL + "/add_classic_token", params, true);
}

/**
 * Add GitLab classic token
 */
export async function addGitLabClassicToken(params: {
  user_id: string;
  user_name: string;
  token: string;
}) {
  return postApi<void>(USER_URL + "/add_classic_gitlab_token", params, true);
}

/**
 * Set user API key configuration
 */
export async function setUserAPIKey(params: ISetUserAPIKeyParam) {
  return postApi<IUserInfo>(USER_URL + "/set_user_config", params, true);
}

// ============================================
// Exports
// ============================================

export const authApi = {
  // Authentication
  getLoginUrl,
  completeLogin,

  // User profile
  getCurrentUserInfo,
  getUserInfoByAuthingId,

  // Git account management
  deleteGitHubAccount,
  deleteGitLabAccount,
  addGitHubClassicToken,
  addGitLabClassicToken,
  setUserAPIKey,
};

export default authApi;
