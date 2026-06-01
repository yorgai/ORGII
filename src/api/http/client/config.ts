/**
 * API Configuration
 *
 * Base URLs, timeouts, and feature flags for the API layer.
 */

// ============================================
// Base URLs
// ============================================

/** API Base URLs - Configurable via environment variables */
export const API_BASE_URLS: Record<import("./types").ApiTarget, string> = {
  main: process.env.REACT_APP_LOCALURL || "",
  agent:
    process.env.REACT_APP_AGENT_URL || process.env.REACT_APP_LOCALURL || "",
  hostedService:
    process.env.REACT_APP_MARKETPLACE_URL || "http://127.0.0.1:8001",
};

// ============================================
// Timeouts
// ============================================

/** Default timeout for most APIs (30 seconds) */
export const DEFAULT_TIMEOUT = 30000;

/** Extended timeout for hosted-service APIs (5 minutes) - needed for LLM extraction operations */
export const HOSTED_SERVICE_TIMEOUT = 300000;

/** Duration for error notifications */
export const NOTIFICATION_DURATION = 10000;

/** Duration for server error notifications */
export const SERVER_ERROR_NOTIFICATION_DURATION = 10000;

// ============================================
// Feature Flags
// ============================================

/**
 * Error handling behavior configuration
 * Set REACT_APP_REDIRECT_ON_500=true to enable legacy redirect behavior
 */
export const ERROR_CONFIG = {
  redirectOn500: process.env.REACT_APP_REDIRECT_ON_500 === "true",
} as const;
