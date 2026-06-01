import { getVersion } from "@tauri-apps/api/app";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useEffect } from "react";

import Message from "@src/components/Message";
import i18n from "@src/i18n";
import { isTauriDesktop } from "@src/util/platform/tauri";

export async function checkForAppUpdates(
  onUserClick = false,
  autoInstall = false
) {
  try {
    const currentVersion = await getVersion();
    const update = await check();
    const t = i18n.t.bind(i18n);

    if (!update?.available) {
      if (onUserClick) {
        await message(
          `You are already on the latest version! (v${currentVersion})`,
          {
            title: "No Updates Available",
            kind: "info",
            okLabel: t("common:common.ok"),
          }
        );
      }
    } else if (update?.available) {
      if (autoInstall) {
        // Automatically download and install update without user confirmation
        Message.info(
          `Automatically downloading and installing update (v${update.version})...`
        );

        await update.downloadAndInstall();

        // Notify user that the app will restart
        await message(
          `Update (v${update.version}) has been downloaded. The app will restart to complete installation.`,
          {
            title: t("confirmation.updateTitle"),
            kind: "info",
            okLabel: t("actions.restart"),
          }
        );

        await relaunch();
      } else {
        // Ask user if they want to update
        const yes = await ask(
          t("confirmation.updateMessage", {
            version: update.version,
            current: currentVersion,
            body: update.body || "",
          }),
          {
            title: t("confirmation.updateTitle"),
            kind: "info",
            okLabel: t("actions.update"),
            cancelLabel: t("actions.cancel"),
          }
        );

        if (yes) {
          await update.downloadAndInstall();
          await relaunch();
        }
      }
    }
  } catch (err) {
    console.error("Update check failed:", err);
    if (onUserClick) {
      await message(`Update check failed: ${err}`, {
        title: "Update Error",
        kind: "error",
        okLabel: i18n.t("common:common.ok"),
      });
    }
  }
}

export function AppUpdater() {
  useEffect(() => {
    // Only check for updates in Tauri environment
    if (!isTauriDesktop()) return;

    // Check once on app startup and auto-install
    checkForAppUpdates(false, true);

    // Check every hour and auto-install
    const interval = setInterval(
      () => checkForAppUpdates(false, true),
      60 * 60 * 1000
    );
    return () => clearInterval(interval);
  }, []);

  return null; // This component doesn't render any UI, only handles background update checks
}

// Export manual check update function for use in Settings page
export const checkForUpdatesManually = () => {
  if (isTauriDesktop()) {
    checkForAppUpdates(true, false); // Don't auto-install on manual check
  } else {
    Message.info("This feature is only available in desktop app");
  }
};
