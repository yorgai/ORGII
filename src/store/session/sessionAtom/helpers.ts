/**
 * Session Helpers
 *
 * Utility functions for session ID validation and localStorage persistence.
 */
import { createLogger } from "@src/hooks/logger";

import { SESSION_CACHE_INVALIDATION_KEY } from "./atoms";

const log = createLogger("SessionAtom");

/**
 * Validate if a string is a valid UUID
 */
export const isValidSessionUUID = (id: string): boolean => {
  if (!id) return false;
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

/**
 * Get cache invalidation timestamp
 */
export const getSessionCacheInvalidationTimestamp = (): number | null => {
  try {
    const timestamp = localStorage.getItem(SESSION_CACHE_INVALIDATION_KEY);
    return timestamp ? parseInt(timestamp, 10) : null;
  } catch (error) {
    log.error(
      "[SessionAtom] Failed to get cache invalidation timestamp:",
      error
    );
    return null;
  }
};
