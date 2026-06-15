/**
 * App Update Actions
 *
 * Manual "check for updates" entry point, mirroring the Settings → General
 * "Detect Update" button. The underlying helper guards non-desktop platforms
 * (`isTauriDesktop()`), so the action is safe to dispatch anywhere.
 *
 * Category: "app"
 */
import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineAppActionRegistration } from "@src/ActionSystem/schema/actionRegistration";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import { checkForUpdatesManually } from "@src/scaffold/AppUpdater";

const emptyParams = z.object({});

const appCheckForUpdates = defineZodAction(
  {
    id: ACTION_ID.APP_CHECK_FOR_UPDATES,
    category: "app",
    description: "Check for application updates",
    params: emptyParams,
    layer: "gui",
    examples: ["check for updates", "detect update", "update the app"],
  },
  async () => {
    checkForUpdatesManually();
    return { success: true, message: "Checking for updates" };
  }
);

export const updateZodActions = [appCheckForUpdates];

export const updateActionRegistration =
  defineAppActionRegistration(updateZodActions);
