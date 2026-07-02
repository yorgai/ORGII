/**
 * Deep Link Handler Hook
 *
 * Handles deep link URLs (yorgai:// and orgii://) in Tauri production mode.
 * This is critical for:
 *   - OAuth callbacks where Supabase redirects to yorgai://marketplace/callback
 *     after authentication.
 *   - Collaboration invite links of the form
 *     orgii://collaboration/join?hub=…&invite=… which route the user into the
 *     collaboration JOIN flow with the hub + invite prefilled.
 *
 * The hook listens for deep link events from Tauri and either routes the
 * React Router to the appropriate path or opens the collaboration JOIN surface.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import { log, logDebug, logError, logWarn } from "@src/hooks/logger";
import { collabPendingInviteAtom } from "@src/store/collaboration/collabPendingInviteAtom";
import { collabPendingShareAtom } from "@src/store/collaboration/collabPendingShareAtom";
import {
  type CollabJoinDeepLink,
  type CollabShareDeepLink,
  parseCollabJoinDeepLink,
  parseCollabShareDeepLink,
} from "@src/store/collaboration/deepLink";
import {
  CHAT_PANEL_SURFACE_KIND,
  activeStationChatVisibleAtom,
  chatPanelNavigateAtom,
} from "@src/store/ui/chatPanelAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { isTauriReady } from "@src/util/platform/tauri/init";

/**
 * Track a share deep-link URL as re-armable (design §6.4). A share link is
 * one-shot plaintext the owner can't regenerate, so unlike a join link it
 * must stay re-clickable after its import dialog is dismissed. When a NEW
 * share link supersedes one whose dialog was never dismissed, the old URL is
 * re-armed (removed from the dedup set) IMMEDIATELY — otherwise it would be
 * dedup-blocked forever, because the dismiss-time sweep only sees the
 * currently tracked set.
 *
 * Exported for tests; pure with respect to its arguments.
 */
export function trackReArmableShareUrl(
  processedUrls: Set<string>,
  reArmableShareUrls: Set<string>,
  url: string
): void {
  for (const pendingUrl of reArmableShareUrls) {
    if (pendingUrl !== url) processedUrls.delete(pendingUrl);
  }
  reArmableShareUrls.clear();
  reArmableShareUrls.add(url);
}

/**
 * Re-arm every tracked share URL once the pending share clears (dialog
 * dismissed or import finished): drop them from the dedup set so re-clicking
 * the same one-shot link re-opens the dialog. Exported for tests.
 */
export function reArmTrackedShareUrls(
  processedUrls: Set<string>,
  reArmableShareUrls: Set<string>
): void {
  for (const url of reArmableShareUrls) {
    processedUrls.delete(url);
  }
  reArmableShareUrls.clear();
}

/**
 * Parse a deep link URL and extract the path and query string
 * @param deepLinkUrl - The deep link URL (e.g., yorgai://marketplace/callback?code=xxx)
 * @returns Object with path and search, or null if invalid
 */
function parseDeepLink(
  deepLinkUrl: string
): { path: string; search: string } | null {
  try {
    // Deep links come in format: <scheme>://path or <scheme>://path?query
    // We convert to React Router path: /orgii/path?query
    //
    // Two distinct identifiers — do not collapse:
    //   - URL schemes `yorgai://` / `orgii://` — the OS-level deep link
    //     protocols; both must be listed in tauri.conf.json's
    //     `deep-link.desktop.schemes`. `yorgai` must also be registered in
    //     Supabase Auth redirect URLs so production desktop OAuth callbacks
    //     can return to the app.
    //   - In-app route prefix `/orgii` — the React Router base path.
    //
    // NOTE: `orgii://collaboration/join` and `orgii://collaboration/session`
    // are intercepted earlier (see `parseCollabJoinDeepLink` /
    // `parseCollabShareDeepLink`) and never reach this generic conversion.

    const withoutProtocol = deepLinkUrl.replace(/^(?:yorgai|orgii):\/\//, "");

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
    logError("DeepLinkHandler", "Failed to parse deep link:", error);
    return null;
  }
}

/**
 * Hook to handle deep link navigation
 * Should be mounted once at the app root level
 */
export function useDeepLinkHandler(): void {
  const navigate = useNavigate();
  const setPendingInvite = useSetAtom(collabPendingInviteAtom);
  const setPendingShare = useSetAtom(collabPendingShareAtom);
  const pendingShare = useAtomValue(collabPendingShareAtom);
  const navigateChatPanel = useSetAtom(chatPanelNavigateAtom);
  const setStationMode = useSetAtom(stationModeAtom);
  const setStationChatVisible = useSetAtom(activeStationChatVisibleAtom);
  const hasSetupListener = useRef(false);
  const hasProcessedInitialDeepLink = useRef(false);
  const processedDeepLinks = useRef<Set<string>>(new Set());
  // Share URLs waiting to be re-armed (see trackReArmableShareUrl): dropped
  // from the dedup set once the pending share clears, so the one-shot link
  // stays re-clickable after the dialog is dismissed without importing.
  const reArmableShareUrls = useRef<Set<string>>(new Set());
  const unlistenRef = useRef<(() => void) | null>(null);

  // Route an incoming collaboration invite into the JOIN flow: stash the
  // parsed hub + invite for the form to consume, make sure we are on the
  // Workstation surface that hosts the chat-panel, and open the
  // NEW_COLLAB_ORG surface (the same one "添加 ORG" opens). Stable across
  // renders so the live `onOpenUrl` listener never captures a stale closure.
  const routeToCollabJoin = useCallback(
    (invite: CollabJoinDeepLink) => {
      setPendingInvite(invite);
      setStationMode("my-station");
      setStationChatVisible("my-station", true);
      if (window.location.pathname !== ROUTES.workStation.code.path) {
        navigate(ROUTES.workStation.code.path);
      }
      navigateChatPanel({ kind: CHAT_PANEL_SURFACE_KIND.NEW_COLLAB_ORG });
    },
    [
      navigate,
      navigateChatPanel,
      setPendingInvite,
      setStationChatVisible,
      setStationMode,
    ]
  );

  // Route an incoming session share link (design §6.4): park the parsed
  // three-piece in the one-shot pending atom and make sure the Workstation
  // surface that hosts the confirmation dialog is visible. The dialog itself
  // resolves the token, imports read-only and (for combined links) surfaces
  // the "join this org" CTA — share resolves FIRST, invite is deferred.
  useEffect(() => {
    // Pending share cleared (dialog dismissed or import done) → re-arm the
    // tracked links so re-clicking the same one-shot URL re-opens the dialog.
    if (pendingShare === null && reArmableShareUrls.current.size > 0) {
      reArmTrackedShareUrls(
        processedDeepLinks.current,
        reArmableShareUrls.current
      );
    }
  }, [pendingShare]);

  const routeToCollabShare = useCallback(
    (share: CollabShareDeepLink) => {
      setPendingShare(share);
      setStationMode("my-station");
      setStationChatVisible("my-station", true);
      if (window.location.pathname !== ROUTES.workStation.code.path) {
        navigate(ROUTES.workStation.code.path);
      }
    },
    [navigate, setPendingShare, setStationChatVisible, setStationMode]
  );

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

            // Share links take precedence (design §6.4): a combined
            // share+invite link is consumed share-first; the invite rides
            // along inside the pending share for the post-import CTA.
            const collabShare = parseCollabShareDeepLink(url);
            if (collabShare) {
              processedDeepLinks.current.add(url);
              trackReArmableShareUrl(
                processedDeepLinks.current,
                reArmableShareUrls.current,
                url
              );
              log(
                "DeepLinkHandler",
                "Routing collaboration session share into import flow"
              );
              routeToCollabShare(collabShare);
              break;
            }

            const collabInvite = parseCollabJoinDeepLink(url);
            if (collabInvite) {
              processedDeepLinks.current.add(url);
              log(
                "DeepLinkHandler",
                "Routing collaboration invite into JOIN flow"
              );
              routeToCollabJoin(collabInvite);
              break;
            }

            const parsed = parseDeepLink(url);
            if (!parsed) {
              logWarn("DeepLinkHandler", "Could not parse deep link:", url);
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
        logError(
          "DeepLinkHandler",
          "Failed to setup deep link listener:",
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
  }, [navigate, routeToCollabJoin, routeToCollabShare]);

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

            const collabShare = parseCollabShareDeepLink(url);
            if (collabShare) {
              processedDeepLinks.current.add(url);
              trackReArmableShareUrl(
                processedDeepLinks.current,
                reArmableShareUrls.current,
                url
              );
              log(
                "DeepLinkHandler",
                "Routing initial collaboration session share into import flow"
              );
              routeToCollabShare(collabShare);
              break;
            }

            const collabInvite = parseCollabJoinDeepLink(url);
            if (collabInvite) {
              processedDeepLinks.current.add(url);
              log(
                "DeepLinkHandler",
                "Routing initial collaboration invite into JOIN flow"
              );
              routeToCollabJoin(collabInvite);
              break;
            }

            const parsed = parseDeepLink(url);
            if (!parsed) {
              continue;
            }

            processedDeepLinks.current.add(url);

            if (
              window.location.pathname + window.location.search !==
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
        logDebug(
          "DeepLinkHandler",
          "Could not check initial deep link:",
          error
        );
      }
    };

    checkInitialDeepLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount, not on location change
}

export default useDeepLinkHandler;
