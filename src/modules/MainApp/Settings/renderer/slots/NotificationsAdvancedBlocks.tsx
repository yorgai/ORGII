import {
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  checkNotificationPermission,
  playCompletionSound,
  sendTestNotification,
} from "@src/api/services/notification";
import Button from "@src/components/Button";
import Message from "@src/components/Message";
import Slider from "@src/components/Slider";
import Switch from "@src/components/Switch";
import { NAV_BUTTON_PROPS } from "@src/modules/MainApp/Settings/config";
import { useSetting } from "@src/store/settings";
import { isMacOS } from "@src/util/platform/tauri";

interface NotificationCategoryConfig {
  key:
    | "taskCompletion"
    | "agentApproval"
    | "errors"
    | "sessionStatus"
    | "gitOperations";
  labelKey: string;
}

const NOTIFICATION_CATEGORIES: NotificationCategoryConfig[] = [
  {
    key: "taskCompletion",
    labelKey: "notifications.taskCompletion",
  },
  {
    key: "agentApproval",
    labelKey: "notifications.agentApproval",
  },
  {
    key: "errors",
    labelKey: "notifications.errors",
  },
  {
    key: "sessionStatus",
    labelKey: "notifications.sessionStatus",
  },
  {
    key: "gitOperations",
    labelKey: "notifications.gitOperations",
  },
];

const NotificationsAdvancedBlocks: React.FC = () => {
  const { t } = useTranslation("settings");
  const [enabled] = useSetting("notifications.enabled");
  const [completionSound, setCompletionSound] = useSetting(
    "notifications.completionSound"
  );
  const [systemNotificationEnabled, setSystemNotificationEnabled] = useSetting(
    "notifications.systemNotificationEnabled"
  );
  const [dockBadgeEnabled, setDockBadgeEnabled] = useSetting(
    "notifications.dockBadgeEnabled"
  );
  const [soundVolume, setSoundVolume] = useSetting("notifications.soundVolume");
  const [taskCompletion, setTaskCompletion] = useSetting(
    "notifications.categories.taskCompletion"
  );
  const [agentApproval, setAgentApproval] = useSetting(
    "notifications.categories.agentApproval"
  );
  const [errors, setErrors] = useSetting("notifications.categories.errors");
  const [sessionStatus, setSessionStatus] = useSetting(
    "notifications.categories.sessionStatus"
  );
  const [gitOperations, setGitOperations] = useSetting(
    "notifications.categories.gitOperations"
  );

  const [permissionStatus, setPermissionStatus] = useState<string>("unknown");
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkNotificationPermission().then((status) => {
      if (!cancelled) {
        setPermissionStatus(status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTestNotification = async () => {
    setIsTesting(true);
    try {
      const success = await sendTestNotification({
        enabled,
        systemNotificationEnabled,
        completionSound,
        soundVolume,
        categories: {
          taskCompletion,
          agentApproval,
          errors,
          sessionStatus,
          gitOperations,
        },
      });
      if (success) {
        Message.success(t("notifications.test.sent"));
      } else {
        Message.warning(t("notifications.test.permissionWarning"));
      }
    } catch {
      Message.error(t("notifications.test.sendFailed"));
    } finally {
      setIsTesting(false);
    }
  };

  const handleToggleDockBadge = async () => {
    const newEnabled = !dockBadgeEnabled;
    setDockBadgeEnabled(newEnabled);
    if (!newEnabled) {
      try {
        await invoke("clear_dock_badge");
      } catch (error) {
        console.error("[Notifications] Failed to clear badge:", error);
      }
    }
  };

  const handleVolumeChange: (value: number | [number, number]) => void = (
    value
  ) => {
    const nextVolume = Array.isArray(value) ? value[0] : value;
    setSoundVolume(nextVolume);
  };

  const categoryValues = {
    taskCompletion,
    agentApproval,
    errors,
    sessionStatus,
    gitOperations,
  };

  const categorySetters = {
    taskCompletion: setTaskCompletion,
    agentApproval: setAgentApproval,
    errors: setErrors,
    sessionStatus: setSessionStatus,
    gitOperations: setGitOperations,
  } as const;

  if (!enabled) {
    return null;
  }

  return (
    <>
      <SectionContainer>
        <SectionRow label={t("notifications.enableSound")}>
          <Switch
            checked={completionSound}
            onChange={() => setCompletionSound(!completionSound)}
          />
        </SectionRow>

        {completionSound && (
          <SectionRow label={t("notifications.volume")}>
            <div className="w-[160px] max-w-full">
              <Slider
                value={soundVolume}
                onChange={handleVolumeChange}
                min={0}
                max={100}
                showTooltip={false}
                noPadding
              />
            </div>
          </SectionRow>
        )}
      </SectionContainer>

      {completionSound && (
        <SectionContainer>
          {NOTIFICATION_CATEGORIES.map((category) => (
            <SectionRow key={category.key} label={t(category.labelKey)}>
              <Switch
                checked={categoryValues[category.key]}
                onChange={() =>
                  categorySetters[category.key](!categoryValues[category.key])
                }
              />
            </SectionRow>
          ))}
        </SectionContainer>
      )}

      <SectionContainer>
        <SectionRow label={t("notifications.enableSystem")}>
          <Switch
            checked={systemNotificationEnabled}
            onChange={() =>
              setSystemNotificationEnabled(!systemNotificationEnabled)
            }
          />
        </SectionRow>
        {systemNotificationEnabled && (
          <SectionRow
            label={t("notifications.systemPermission")}
            indent
            description={
              permissionStatus === "granted"
                ? t("notifications.notificationsAllowed")
                : permissionStatus === "denied"
                  ? t("notifications.notificationsBlocked")
                  : t("notifications.permissionNotRequested")
            }
          >
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap text-xs text-text-1">
                {permissionStatus === "granted"
                  ? t("notifications.granted")
                  : permissionStatus === "denied"
                    ? t("notifications.denied")
                    : t("common:status.unknown")}
              </span>
              {isMacOS() && (
                <Button
                  {...NAV_BUTTON_PROPS}
                  onClick={() => {
                    shellOpen(
                      "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
                    );
                  }}
                >
                  {t("common:actions.configure")}
                </Button>
              )}
            </div>
          </SectionRow>
        )}
      </SectionContainer>

      <SectionContainer>
        <SectionRow label={t("notifications.enableDockBadge")}>
          <Switch checked={dockBadgeEnabled} onChange={handleToggleDockBadge} />
        </SectionRow>
      </SectionContainer>

      <SectionContainer>
        <SectionRow label={t("notifications.testNotification")}>
          <div className="flex items-center gap-2">
            <Button
              size="default"
              onClick={handleTestNotification}
              loading={isTesting}
              disabled={permissionStatus !== "granted"}
            >
              {t("notifications.notification")}
            </Button>
            <Button
              size="default"
              onClick={() => playCompletionSound(soundVolume)}
              disabled={!completionSound}
            >
              {t("notifications.sound")}
            </Button>
          </div>
        </SectionRow>
      </SectionContainer>
    </>
  );
};

export default NotificationsAdvancedBlocks;
