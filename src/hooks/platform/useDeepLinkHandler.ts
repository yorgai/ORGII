/**
 * Deep Link Handler Hook
 *
 * Handles deep link URLs (yorgai://) in Tauri production mode.
 * This is critical for OAuth callbacks where Auth0 redirects to
 * yorgai://marketplace/callback after authentication.
 *
 * The hook listens for deep link events from Tauri and navigates
 * the React Router to the appropriate route.
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { log } from "@src/hooks/logger";
import { isTauriReady } from "@src/util/platform/tauri/init";

/**
 * Parse a deep link URL and extract the path and query string
 * @param deepLinkUrl - The deep link URL (e.g., yorgai://marketplace/callback?code=xxx)
 * @returns Object with path and search, or null if invalid
 */
function parseDeepLink(
  deepLinkUrl: string
): { path: string; search: string } | null {
  try {
    // Deep links come in format: yorgai://path or yorgai://path?query
    // We convert to React Router path: /orgii/path?query
    //
    // Two distinct identifiers — do not collapse:
    //   - URL scheme `yorgai://` — the OS-level deep link protocol; must match
    //     the Auth0 "Allowed Callback URLs" entry and tauri.conf.json's
    //     `deep-link.desktop.schemes`. Auth0 API identifiers are immutable
    //     so this stays "yorgai" even after the brand rename to ORGII.
    //   - In-app route prefix `/orgii` — the React Router base path.

    const withoutProtocol = deepLinkUrl.replace(/^yorgai:\/\//, "");

    // Split path and query
    const [pathPart, ...queryParts] = withoutProtocol.split("?");
    const search = queryParts.length > 0 ? `?${queryParts.join("?")}` : "";

    // Normalize the path - add /orgii prefix if not present
    let path = pathPart;
    if (!path.startsWith("/")) {
      path = "/" + path;
    }
    if (!path.startsWith("/orgii")) {
      path = "/orgii" + path;
    }

    return { path, search };
  } catch (error) {
    console.error("[DeepLinkHandler] Failed to parse deep link:", error);
    return null;
  }
}

/**
 * Hook to handle deep link navigation
 * Should be mounted once at the app root level
 */
export function useDeepLinkHandler(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const hasSetupListener = useRef(false);
  const hasProcessedInitialDeepLink = useRef(false);
  const processedDeepLinks = useRef<Set<string>>(new Set());
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Only run in Tauri environment
    if (!isTauriReady()) {
      return;
    }

    // Prevent duplicate listeners
    if (hasSetupListener.current) {
      return;
    }

    const setupDeepLinkListener = async () => {
      try {
        // Import the deep link plugin
        const { onOpenUrl } = await import("@tauri-apps/plugin-deep-link");

        log("DeepLinkHandler", "Setting up deep link listener...");

        // Listen for deep link URLs
        const unlisten = await onOpenUrl((urls: string[]) => {
          for (const url of urls) {
            if (processedDeepLinks.current.has(url)) {
              continue;
            }

            const parsed = parseDeepLink(url);
            if (!parsed) {
              console.warn("[DeepLinkHandler] Could not parse deep link:", url);
              continue;
            }

            processedDeepLinks.current.add(url);
            log(
              "DeepLinkHandler",
              "Navigating to:",
              parsed.path + parsed.search
            );
            navigate(parsed.path + parsed.search, { replace: true });
            break;
          }
        });

        unlistenRef.current = unlisten;
        hasSetupListener.current = true;
        log("DeepLinkHandler", "Deep link listener ready");
      } catch (error) {
        console.error(
          "[DeepLinkHandler] Failed to setup deep link listener:",
          error
        );
      }
    };

    setupDeepLinkListener();

    // Cleanup
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
        hasSetupListener.current = false;
      }
    };
  }, [navigate]);

  // Also check for deep link on initial load (app opened via deep link)
  // This effect should only run ONCE on mount, not on every location change
  useEffect(() => {
    // Only process initial deep link once
    if (hasProcessedInitialDeepLink.current) {
      return;
    }

    const checkInitialDeepLink = async () => {
      if (!isTauriReady()) {
        return;
      }

      try {
        const { getCurrent } = await import("@tauri-apps/plugin-deep-link");
        const initialUrls = await getCurrent();

        if (initialUrls && initialUrls.length > 0) {
          hasProcessedInitialDeepLink.current = true;

          for (const url of initialUrls) {
            if (processedDeepLinks.current.has(url)) {
              continue;
            }

            const parsed = parseDeepLink(url);
            if (!parsed) {
              continue;
            }

            processedDeepLinks.current.add(url);

            if (
              location.pathname + location.search !==
              parsed.path + parsed.search
            ) {
              log(
                "DeepLinkHandler",
                "Navigating to initial deep link:",
                parsed.path + parsed.search
              );
              navigate(parsed.path + parsed.search, { replace: true });
              break;
            }
          }
        }
      } catch (error) {
        // getCurrent may not be available in all versions of the plugin
        // eslint-disable-next-line no-console
        console.debug(
          "[DeepLinkHandler] Could not check initial deep link:",
          error
        );
      }
    };

    checkInitialDeepLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount, not on location change
}

export default useDeepLinkHandler;
