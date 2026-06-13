import { getVersion } from "@tauri-apps/api/app";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { atom, useAtomValue } from "jotai";
import { useEffect } from "react";

import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import i18n from "@src/i18n";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { isTauriDesktop } from "@src/util/platform/tauri";

const log = createLogger("AppUpdater");

type AppUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;

const availableAppUpdateAtom = atom<AppUpdate | null>(null);
const appUpdateInstallingAtom = atom(false);

function getAppUpdaterStore() {
  return getInstrumentedStore();
}

export function useAvailableAppUpdate() {
  return useAtomValue(availableAppUpdateAtom);
}

export function useIsAppUpdateInstalling() {
  return useAtomValue(appUpdateInstallingAtom);
}

function setAvailableAppUpdate(update: AppUpdate | null) {
  getAppUpdaterStore().set(availableAppUpdateAtom, update);
}

function setAppUpdateInstalling(installing: boolean) {
  getAppUpdaterStore().set(appUpdateInstallingAtom, installing);
}

async function installAppUpdate(update: AppUpdate) {
  const t = i18n.t.bind(i18n);
  setAppUpdateInstalling(true);
  try {
    Message.info(`Downloading and installing update (v${update.version})...`);
    await update.downloadAndInstall();
    await message(
      `Update (v${update.version}) has been downloaded. The app will restart to complete installation.`,
      {
        title: t("confirmation.updateTitle"),
        kind: "info",
        okLabel: t("actions.restart"),
      }
    );
    await relaunch();
  } finally {
    setAppUpdateInstalling(false);
  }
}

export async function installAvailableAppUpdate() {
  if (!isTauriDesktop()) {
    Message.info("This feature is only available in desktop app");
    return;
  }

  const update = getAppUpdaterStore().get(availableAppUpdateAtom);
  if (!update?.available) {
    await checkForAppUpdates(true);
    return;
  }

  await installAppUpdate(update);
}

export async function checkForAppUpdates(onUserClick = false) {
  try {
    const currentVersion = await getVersion();
    const update = await check();
    const t = i18n.t.bind(i18n);

    if (!update?.available) {
      setAvailableAppUpdate(null);
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
      return;
    }

    setAvailableAppUpdate(update);

    if (!onUserClick) return;

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
      await installAppUpdate(update);
    }
  } catch (err) {
    log.error("Update check failed:", err);
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
    if (!isTauriDesktop()) return;

    checkForAppUpdates(false);

    const interval = setInterval(
      () => checkForAppUpdates(false),
      60 * 60 * 1000
    );
    return () => clearInterval(interval);
  }, []);

  return null;
}

export const checkForUpdatesManually = () => {
  if (isTauriDesktop()) {
    checkForAppUpdates(true);
  } else {
    Message.info("This feature is only available in desktop app");
  }
};
