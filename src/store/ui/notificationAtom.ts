/**
 * Notification Settings
 *
 * Backed by the central settings system (~/.orgii/settings.jsonc).
 * The flat settings keys are assembled into the NotificationSettings interface
 * for read-only consumers (write paths use the slot-row controls in
 * `Settings/renderer/slots/Notifications*`, which call `useSetting` directly).
 */
import { atom } from "jotai";

import { settingsAtom } from "@src/store/settings/settingsAtom";

export interface NotificationSettings {
  enabled: boolean;
  systemNotificationEnabled: boolean;
  completionSound: boolean;
  soundVolume: number;
  categories: {
    taskCompletion: boolean;
    agentApproval: boolean;
    errors: boolean;
    sessionStatus: boolean;
    gitOperations: boolean;
  };
}

export const notificationSettingsAtom = atom<NotificationSettings>((get) => {
  const settings = get(settingsAtom);
  return {
    enabled: settings["notifications.enabled"],
    systemNotificationEnabled:
      settings["notifications.systemNotificationEnabled"],
    completionSound: settings["notifications.completionSound"],
    soundVolume: settings["notifications.soundVolume"],
    categories: {
      taskCompletion: settings["notifications.categories.taskCompletion"],
      agentApproval: settings["notifications.categories.agentApproval"],
      errors: settings["notifications.categories.errors"],
      sessionStatus: settings["notifications.categories.sessionStatus"],
      gitOperations: settings["notifications.categories.gitOperations"],
    },
  };
});
notificationSettingsAtom.debugLabel = "notificationSettingsAtom";
