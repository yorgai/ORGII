/**
 * Authentication API Endpoints
 *
 * Combined exports for all authentication-related endpoints:
 * - login: OAuth login flow, user profile, git account management
 * - token: Auth0 token exchange and refresh
 * - secure: Secure keychain-based token storage
 */

// Main authentication API (OAuth login, user profile, git accounts)
export {
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
  // Namespace export
  authApi,
} from "./login";

// Auth0 token exchange and refresh
export {
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeRefreshToken,
  auth0TokenApi,
  type TokenResponse,
  type TokenError,
} from "./token";

// Secure keychain-based token storage
export {
  secureStoreTokens,
  secureGetAuthState,
  secureGetAccessToken,
  secureGetRefreshToken,
  secureIsTokenExpiring,
  secureClearTokens,
  auth0ExchangeAndStore,
  auth0RefreshAndStore,
  auth0RevokeToken,
  type AuthState,
  type TokenResponse as SecureTokenResponse,
} from "./secure";

// Default export - main auth API
export { default } from "./login";
