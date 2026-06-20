import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { atom, useAtomValue } from "jotai";
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect } from "react";

import Button from "@src/components/Button";
import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import i18n from "@src/i18n";
import Modal from "@src/scaffold/ModalSystem";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { isTauriDesktop } from "@src/util/platform/tauri";

const log = createLogger("AppUpdater");

const TEMPORARY_FORCE_APP_UPDATE_UI_FOR_TESTING = false;

const skippedAppUpdateVersions = new Set<string>();

type AppUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;
type AppUpdateDownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };
type AppUpdateProgressPhase = "idle" | "downloading" | "installing";

interface AppUpdateProgress {
  phase: AppUpdateProgressPhase;
  downloadedBytes: number;
  totalBytes: number | null;
}

const EMPTY_APP_UPDATE_PROGRESS: AppUpdateProgress = {
  phase: "idle",
  downloadedBytes: 0,
  totalBytes: null,
};

const availableAppUpdateAtom = atom<AppUpdate | null>(null);
const appUpdateInstallingAtom = atom(false);
const appUpdateModalOpenAtom = atom(false);
const appUpdateCurrentVersionAtom = atom<string | null>(null);
const appUpdateProgressAtom = atom<AppUpdateProgress>(
  EMPTY_APP_UPDATE_PROGRESS
);

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

function setAppUpdateModalOpen(open: boolean) {
  getAppUpdaterStore().set(appUpdateModalOpenAtom, open);
}

function setAppUpdateCurrentVersion(version: string | null) {
  getAppUpdaterStore().set(appUpdateCurrentVersionAtom, version);
}

function setAppUpdateProgress(progress: AppUpdateProgress) {
  getAppUpdaterStore().set(appUpdateProgressAtom, progress);
}

function formatAppUpdateBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAppUpdateProgressPercent(progress: AppUpdateProgress) {
  if (!progress.totalBytes) return null;
  return Math.min(
    100,
    Math.max(
      0,
      Math.round((progress.downloadedBytes / progress.totalBytes) * 100)
    )
  );
}

function getTemporaryTestAppUpdate(): AppUpdate {
  return {
    available: true,
    version: "1.0.2",
    body: "Temporary update dialog for UI testing.",
    date: new Date().toISOString(),
    downloadAndInstall: async (
      onEvent?: (event: AppUpdateDownloadEvent) => void
    ) => {
      const totalBytes = 180 * 1024 * 1024;
      onEvent?.({ event: "Started", data: { contentLength: totalBytes } });
      for (let downloadedBytes = 0; downloadedBytes < totalBytes; ) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 90));
        const chunkLength = Math.min(
          12 * 1024 * 1024,
          totalBytes - downloadedBytes
        );
        downloadedBytes += chunkLength;
        onEvent?.({ event: "Progress", data: { chunkLength } });
      }
      onEvent?.({ event: "Finished" });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
    },
  } as AppUpdate;
}

async function installAppUpdate(update: AppUpdate) {
  setAppUpdateInstalling(true);
  setAppUpdateProgress(EMPTY_APP_UPDATE_PROGRESS);
  let downloadedBytes = 0;

  try {
    Message.info(
      i18n.t("common:update.downloadingAndInstalling", {
        version: update.version,
      })
    );
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started": {
          downloadedBytes = 0;
          setAppUpdateProgress({
            phase: "downloading",
            downloadedBytes,
            totalBytes: event.data.contentLength ?? null,
          });
          break;
        }
        case "Progress": {
          downloadedBytes += event.data.chunkLength;
          const previousProgress = getAppUpdaterStore().get(
            appUpdateProgressAtom
          );
          setAppUpdateProgress({
            phase: "downloading",
            downloadedBytes,
            totalBytes: previousProgress.totalBytes,
          });
          break;
        }
        case "Finished": {
          const previousProgress = getAppUpdaterStore().get(
            appUpdateProgressAtom
          );
          setAppUpdateProgress({
            phase: "installing",
            downloadedBytes: previousProgress.totalBytes ?? downloadedBytes,
            totalBytes: previousProgress.totalBytes,
          });
          break;
        }
      }
    });
    if (TEMPORARY_FORCE_APP_UPDATE_UI_FOR_TESTING) {
      Message.info(
        `Update v${update.version} install flow completed for UI testing.`
      );
      setAppUpdateProgress(EMPTY_APP_UPDATE_PROGRESS);
      return;
    }
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

  setAppUpdateModalOpen(true);
}

export async function checkForAppUpdates(onUserClick = false) {
  const checkingMessageId = onUserClick
    ? Message.info({
        content: "Checking for updates…",
        duration: 0,
        closable: false,
        icon: <LoaderCircle size={18} className="animate-spin" />,
      })
    : "";

  try {
    const currentVersion = await getVersion();
    const update = TEMPORARY_FORCE_APP_UPDATE_UI_FOR_TESTING
      ? getTemporaryTestAppUpdate()
      : await check();

    setAppUpdateCurrentVersion(currentVersion);

    if (!update?.available) {
      setAvailableAppUpdate(null);
      if (onUserClick) {
        Message.info(
          `You are already on the latest version! (v${currentVersion})`
        );
      }
      return;
    }

    if (!onUserClick && skippedAppUpdateVersions.has(update.version)) return;

    setAvailableAppUpdate(update);

    if (onUserClick) {
      setAppUpdateModalOpen(true);
    }
  } catch (err) {
    log.error("Update check failed:", err);
    if (onUserClick) {
      Message.error(`Update check failed: ${err}`);
    }
  } finally {
    if (checkingMessageId) {
      Message.remove(checkingMessageId);
    }
  }
}

function AppUpdateModal() {
  const update = useAtomValue(availableAppUpdateAtom);
  const currentVersion = useAtomValue(appUpdateCurrentVersionAtom);
  const open = useAtomValue(appUpdateModalOpenAtom);
  const installing = useAtomValue(appUpdateInstallingAtom);
  const progress = useAtomValue(appUpdateProgressAtom);
  const progressPercent = getAppUpdateProgressPercent(progress);
  const t = i18n.t.bind(i18n);

  const handleLater = useCallback(() => {
    setAppUpdateProgress(EMPTY_APP_UPDATE_PROGRESS);
    setAppUpdateModalOpen(false);
  }, []);

  const handleSkipVersion = useCallback(() => {
    if (update?.version) {
      skippedAppUpdateVersions.add(update.version);
      setAvailableAppUpdate(null);
    }
    setAppUpdateProgress(EMPTY_APP_UPDATE_PROGRESS);
    setAppUpdateModalOpen(false);
  }, [update]);

  const handleInstall = useCallback(() => {
    if (!update?.available) return;
    void installAppUpdate(update);
  }, [update]);

  return (
    <Modal
      visible={open && Boolean(update?.available)}
      title={t("confirmation.updateTitle")}
      width={460}
      closable={false}
      maskClosable={false}
      escToExit={!installing}
      onCancel={handleLater}
      bodyClassName="p-4"
      footerTopBorder={false}
      footer={
        <div className="flex h-12 items-center gap-2 px-3">
          <Button
            variant="tertiary"
            disabled={installing}
            onClick={handleSkipVersion}
          >
            {t("common:actions.skipThisVersion")}
          </Button>
          <div className="flex-1" />
          <Button
            variant="tertiary"
            disabled={installing}
            onClick={handleLater}
          >
            {t("common:actions.later")}
          </Button>
          <Button
            variant="primary"
            loading={installing}
            onClick={handleInstall}
            data-modal-primary-action
          >
            {t("actions.update")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-[13px] leading-5 text-text-3">
        <p>
          {t("confirmation.updateMessage", {
            version: update?.version ?? "",
            current: currentVersion ?? "—",
            body: update?.body || "",
          })}
        </p>
        {installing && (
          <div className="rounded-lg bg-bg-2/70 py-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-[12px] text-text-2">
              <span>
                {progress.phase === "installing"
                  ? t("common:update.installing")
                  : t("common:update.downloading")}
              </span>
              <span>
                {progressPercent === null
                  ? formatAppUpdateBytes(progress.downloadedBytes)
                  : t("common:update.progressPercent", {
                      percent: progressPercent,
                    })}
              </span>
            </div>
            <div className="bg-bg-4 h-2 overflow-hidden rounded-full">
              <div
                className="h-full rounded-full bg-primary-6 transition-[width] duration-200"
                style={{ width: `${progressPercent ?? 100}%` }}
              />
            </div>
            <div className="mt-2 text-[11px] leading-4 text-text-4">
              {progress.totalBytes
                ? t("common:update.downloadedOfTotal", {
                    downloaded: formatAppUpdateBytes(progress.downloadedBytes),
                    total: formatAppUpdateBytes(progress.totalBytes),
                  })
                : t("common:update.preparingDownload")}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function AppUpdater() {
  useEffect(() => {
    if (!isTauriDesktop()) return;

    checkForAppUpdates(TEMPORARY_FORCE_APP_UPDATE_UI_FOR_TESTING);

    const interval = setInterval(
      () => checkForAppUpdates(false),
      60 * 60 * 1000
    );
    return () => clearInterval(interval);
  }, []);

  return <AppUpdateModal />;
}

export const checkForUpdatesManually = async () => {
  if (isTauriDesktop()) {
    await checkForAppUpdates(true);
  } else {
    Message.info("This feature is only available in desktop app");
  }
};
