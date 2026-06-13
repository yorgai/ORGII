/**
 * Utility to clean up localStorage entries with invalid or stale repo/project references
 *
 * NOTE: Most cleanup is now handled automatically by useRepoManager.
 * These utilities are for manual cleanup scenarios.
 */
import { createLogger } from "@src/hooks/logger";
import {
  REPO_STORAGE_KEYS,
  isValidUUID,
  resetRepoStore,
} from "@src/store/repo";

const log = createLogger("StorageCleanup");

// Storage key prefixes that should have valid UUIDs
const UUID_STORAGE_PREFIXES = ["orgii_git_status_cache_"];

// Tab and session persistence keys
const PERSISTENCE_KEYS = ["opcode_tabs_v3", "opcode_active_tab_v3"] as const;

// Additional project/codebase localStorage keys used across the app
const STORY_REPO_STORAGE_KEYS = [
  "curCodeBaseId",
  "cbCardPath",
  "curchatProjectId",
  "curProjectId",
  "curExtensionProjectId",
] as const;

/**
 * Helper to parse localStorage value (handles both raw strings and JSON-encoded strings)
 * atomWithStorage stores values as JSON, so we need to parse them
 */
const parseStorageValue = (rawValue: string): string | null => {
  try {
    const parsed = JSON.parse(rawValue);
    // If it's a string after parsing, return it
    if (typeof parsed === "string") return parsed;
    // If it's something else, return null (not a simple UUID)
    return null;
  } catch {
    // If JSON parsing fails, it's a raw string (legacy format)
    return rawValue;
  }
};

// Keys that should contain UUIDs (not all REPO_STORAGE_KEYS are UUIDs)
const UUID_REPO_KEYS = [
  REPO_STORAGE_KEYS.selectedRepo, // UUID
  REPO_STORAGE_KEYS.lastUsedRepo, // UUID
  // NOT selectedBranch (branch name like "main")
  // NOT cachedRepos (array of CachedRepo objects)
] as const;

/**
 * Clean up all localStorage entries that should contain valid UUIDs but don't
 * This runs on module initialization to catch obviously invalid formats
 */
export const cleanupInvalidUUIDStorage = (): void => {
  try {
    // Clean up only UUID-type repo selection keys
    UUID_REPO_KEYS.forEach((key) => {
      const rawValue = localStorage.getItem(key);
      if (!rawValue) return;

      // Parse the value (handles JSON-encoded strings from atomWithStorage)
      const value = parseStorageValue(rawValue);

      // Only remove if we can parse it and it's definitely not a valid UUID
      if (value !== null && !isValidUUID(value)) {
        localStorage.removeItem(key);
      }
    });

    // Clean up prefixed keys (like git status cache)
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key) continue;

      for (const prefix of UUID_STORAGE_PREFIXES) {
        if (key.startsWith(prefix)) {
          const withoutPrefix = key.replace(prefix, "");
          const possibleUuid = withoutPrefix.split("_")[0];
          if (!isValidUUID(possibleUuid)) {
            keysToRemove.push(key);
          }
        }
      }
    }

    keysToRemove.forEach((key) => {
      localStorage.removeItem(key);
    });
  } catch (error) {
    log.error("[cleanupInvalidStorage] Error during cleanup:", error);
  }
};

/**
 * Deferred cleanup - runs after initial render to avoid blocking startup
 * Uses requestIdleCallback to run when browser is idle
 */
export const deferredCleanup = (): void => {
  const runCleanup = () => {
    cleanupInvalidUUIDStorage();
  };

  // Use requestIdleCallback if available, otherwise setTimeout
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(runCleanup, { timeout: 2000 });
  } else {
    setTimeout(runCleanup, 100);
  }
};

/**
 * Clean up stale repo references based on valid repo IDs from the API
 * Call this after loading repos from the API to remove references to deleted repos
 *
 * NOTE: This is now called automatically by useRepoManager.
 * Use this only for manual cleanup scenarios.
 *
 * @param validRepoIds - Array of valid repo UUIDs from the API
 * @returns Object with cleanup statistics
 */
export const cleanupStaleRepoReferences = (
  validRepoIds: string[]
): {
  removedKeys: string[];
  removedCacheKeys: string[];
  cleanedTabs: boolean;
  cleanedSessions: boolean;
} => {
  const result = {
    removedKeys: [] as string[],
    removedCacheKeys: [] as string[],
    cleanedTabs: false,
    cleanedSessions: false,
  };

  if (!validRepoIds || validRepoIds.length === 0) {
    return result;
  }

  const validRepoSet = new Set(validRepoIds);

  try {
    // 1. Clean up repo-related storage keys
    Object.values(REPO_STORAGE_KEYS).forEach((key) => {
      const value = localStorage.getItem(key);
      if (value && isValidUUID(value) && !validRepoSet.has(value)) {
        localStorage.removeItem(key);
        result.removedKeys.push(key);
      }
    });

    // 2. Clean up git status cache for deleted repos
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key) continue;

      for (const prefix of UUID_STORAGE_PREFIXES) {
        if (key.startsWith(prefix)) {
          const withoutPrefix = key.replace(prefix, "");
          const possibleUuid = withoutPrefix.split("_")[0];
          if (isValidUUID(possibleUuid) && !validRepoSet.has(possibleUuid)) {
            keysToRemove.push(key);
          }
        }
      }
    }

    keysToRemove.forEach((key) => {
      localStorage.removeItem(key);
      result.removedCacheKeys.push(key);
    });

    // 3. Clean up session entries for deleted repos
    const sessionKeysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key && key.startsWith("opcode_session_")) {
        try {
          const sessionData = localStorage.getItem(key);
          if (sessionData) {
            const parsed = JSON.parse(sessionData);
            const repoPath = parsed.repoPath || "";
            const potentialRepoId = repoPath.split("/").pop() || "";
            if (
              isValidUUID(potentialRepoId) &&
              !validRepoSet.has(potentialRepoId)
            ) {
              sessionKeysToRemove.push(key);
            }
          }
        } catch {
          // If we can't parse it, leave it alone
        }
      }
    }

    sessionKeysToRemove.forEach((key) => {
      localStorage.removeItem(key);
    });

    if (sessionKeysToRemove.length > 0) {
      result.cleanedSessions = true;
    }

    return result;
  } catch (error) {
    log.error("[cleanupStaleRepoReferences] Error during cleanup:", error);
    return result;
  }
};

/**
 * Clear project/repo cache data only (not session data)
 * Preserves: theme, timezone, UI settings, etc.
 * Clears: selected repo, git status cache, branch selection, and in-memory Jotai state
 */
export const clearProjectRepoCache = (): { clearedCount: number } => {
  let clearedCount = 0;

  try {
    // Clear repo selection keys from localStorage
    Object.values(REPO_STORAGE_KEYS).forEach((key) => {
      if (localStorage.getItem(key)) {
        localStorage.removeItem(key);
        clearedCount++;
      }
    });

    // Clear legacy project/codebase keys used across the app
    STORY_REPO_STORAGE_KEYS.forEach((key) => {
      if (localStorage.getItem(key)) {
        localStorage.removeItem(key);
        clearedCount++;
      }
    });

    // Clear git status cache and any other project-related prefixed keys
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key) {
        // Clear all git status cache keys
        for (const prefix of UUID_STORAGE_PREFIXES) {
          if (key.startsWith(prefix)) {
            keysToRemove.push(key);
          }
        }
        // Also clear any other project/codebase related keys
        if (
          key.startsWith("cur") || // curCodeBaseId, curProId, etc.
          key.includes("codebase") ||
          key.includes("Codebase") ||
          key.includes("project") ||
          key.includes("Project") ||
          key.includes("workspace") ||
          key.includes("Workspace") ||
          key.includes("repo") ||
          key.includes("Repo")
        ) {
          // Don't remove settings keys
          if (
            !key.includes("theme") &&
            !key.includes("Theme") &&
            !key.includes("setting") &&
            !key.includes("Setting") &&
            !key.includes("config") &&
            !key.includes("Config")
          ) {
            keysToRemove.push(key);
          }
        }
      }
    }

    // Remove duplicates and clear
    const uniqueKeys = [...new Set(keysToRemove)];
    uniqueKeys.forEach((key) => {
      localStorage.removeItem(key);
      clearedCount++;
    });

    // Also clear sessionStorage keys related to sessions/projects
    const sessionKeysToRemove: string[] = [];
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index);
      if (key) {
        if (
          key === "seId" ||
          key.includes("session") ||
          key.includes("Session") ||
          key.includes("project") ||
          key.includes("Project") ||
          key.includes("workspace") ||
          key.includes("Workspace")
        ) {
          sessionKeysToRemove.push(key);
        }
      }
    }
    sessionKeysToRemove.forEach((key) => {
      sessionStorage.removeItem(key);
      clearedCount++;
    });

    // Reset Jotai atoms so useRepoManager will fetch fresh data
    resetRepoStore();
    return { clearedCount };
  } catch (error) {
    log.error("[clearProjectRepoCache] Error during cleanup:", error);
    return { clearedCount };
  }
};

/**
 * Clear session data (tabs, active sessions, session state)
 * Preserves: theme, timezone, UI settings, project selection
 */
export const clearSessionData = (): { clearedCount: number } => {
  let clearedCount = 0;

  try {
    // Clear tab and session persistence
    PERSISTENCE_KEYS.forEach((key) => {
      if (localStorage.getItem(key)) {
        localStorage.removeItem(key);
        clearedCount++;
      }
    });

    // Clear session entries
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key && key.startsWith("opcode_session_")) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => {
      localStorage.removeItem(key);
      clearedCount++;
    });
    return { clearedCount };
  } catch (error) {
    log.error("[clearSessionData] Error during cleanup:", error);
    return { clearedCount };
  }
};

/**
 * Clear all project data (repos + sessions)
 * Preserves: theme, timezone, UI settings
 */
export const clearAllProjectData = (): { clearedCount: number } => {
  const repoResult = clearProjectRepoCache();
  const sessionResult = clearSessionData();

  const totalCleared = repoResult.clearedCount + sessionResult.clearedCount;
  return { clearedCount: totalCleared };
};

// PERFORMANCE: Defer cleanup to avoid blocking startup
// Run cleanup after app initialization using requestIdleCallback
deferredCleanup();

export default cleanupInvalidUUIDStorage;
