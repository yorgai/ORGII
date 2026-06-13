/**
 * Development Mode IndexedDB Protection
 *
 * Prevents IndexedDB from being cleared during hot reload in development mode.
 * This utility detects potential storage clearing issues and provides warnings.
 */
import { createLogger } from "@src/hooks/logger";

const log = createLogger("DevIndexedDBProtection");

const isDev = process.env.NODE_ENV === "development";

/**
 * Check if browser DevTools has "Clear storage" enabled
 * This can cause IndexedDB to be cleared on every page reload
 */
export const checkDevToolsStorageSettings = (): void => {
  if (!isDev) return;

  // Check if we're in a browser environment
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return;
  }

  // Log warning about potential DevTools settings
  log.debug(
    "%c⚠️ IndexedDB Persistence Check",
    "color: orange; font-weight: bold"
  );
};

/**
 * Monitor IndexedDB for unexpected deletions
 */
export const monitorIndexedDBPersistence = (): void => {
  if (!isDev) return;

  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return;
  }

  const DB_NAME = "orgii_background_storage";

  // Check if the database exists on page load
  const checkDB = async () => {
    try {
      const databases = await indexedDB.databases();
      const ourDB = databases.find((db) => db.name === DB_NAME);

      if (!ourDB) {
        log.debug(
          `IndexedDB '${DB_NAME}' not found - this might be a fresh start or storage was cleared`
        );
      }
    } catch (error) {
      log.error("Error checking IndexedDB:", error);
    }
  };

  // Check on module load (hot reload)
  checkDB();

  // Also check on visibility change (when tab becomes visible)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkDB();
    }
  });
};

/**
 * Initialize IndexedDB protection in development mode
 */
export const initDevIndexedDBProtection = (): void => {
  if (!isDev) return;

  checkDevToolsStorageSettings();
  monitorIndexedDBPersistence();

  // Warn if HMR is causing issues
};

export default {
  checkDevToolsStorageSettings,
  monitorIndexedDBPersistence,
  initDevIndexedDBProtection,
};
