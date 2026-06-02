/**
 * useSetupRepoAutoLaunch
 *
 * Listens for the `agent-setup-repo-update` window event with
 * `action === "launch_app"` and automatically opens the app in
 * the WorkStation browser tab (web apps) or shows a toast for
 * non-web apps.
 *
 * Intended to be mounted once per active setup session.
 * Pass `sessionId` to scope events to the correct session.
 * Pass `null` to disable (e.g. when no setup is in progress).
 */
import { useSetAtom } from "jotai";
import { useEffect } from "react";

import {
  AGENT_SIDE_CHANNEL_EVENTS,
  type AgentSetupRepoLaunchAppDetail,
  type AgentSetupRepoUpdateDetail,
} from "@src/engines/SessionCore/sync/adapters/rustAgent/eventHandlers/fileChangeHandlers";
import { createLogger } from "@src/hooks/logger";
import { requestNewBrowserSessionAtom } from "@src/store/workstation/workstationTabBarAtoms";

const logger = createLogger("useSetupRepoAutoLaunch");

export function useSetupRepoAutoLaunch(sessionId: string | null): void {
  const requestNewBrowserSession = useSetAtom(requestNewBrowserSessionAtom);

  useEffect(() => {
    if (!sessionId) return;

    function handleSetupRepoUpdate(event: Event) {
      const customEvent = event as CustomEvent<AgentSetupRepoUpdateDetail>;
      const detail = customEvent.detail;

      if (!detail || detail.sessionId !== sessionId) return;
      if (detail.action !== "launch_app") return;

      const data = detail.data as unknown as AgentSetupRepoLaunchAppDetail & {
        url?: string;
        app_type?: string;
        command?: string;
      };

      const url = data.url;
      const appType = data.app_type ?? data.appType ?? "unknown";
      const command = data.command;

      logger.info(
        `setup complete — app_type=${appType} url=${url ?? "<none>"} command=${command ?? "<none>"}`
      );

      if (url) {
        // Normalize: ensure URL has a scheme so the browser tab accepts it.
        const normalized =
          url.startsWith("http://") || url.startsWith("https://")
            ? url
            : `http://${url}`;

        requestNewBrowserSession({ url: normalized });
        logger.info(`opened browser tab: ${normalized}`);
      }
    }

    window.addEventListener(
      AGENT_SIDE_CHANNEL_EVENTS.SETUP_REPO_UPDATE,
      handleSetupRepoUpdate
    );
    return () => {
      window.removeEventListener(
        AGENT_SIDE_CHANNEL_EVENTS.SETUP_REPO_UPDATE,
        handleSetupRepoUpdate
      );
    };
  }, [sessionId, requestNewBrowserSession]);
}
