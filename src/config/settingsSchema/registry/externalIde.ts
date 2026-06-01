import { z } from "zod";

import type { SettingDefinition } from "@src/config/settingsSchema/types";

export const EXTERNAL_IDE_SETTINGS_REGISTRY = {
  "externalIde.preferred": {
    schema: z.string(),
    default: "Visual Studio Code",
    description:
      'Preferred external IDE for "Open in IDE" actions (e.g., "Visual Studio Code", "Cursor", "WebStorm")',
    category: "externalIde",
  },
  "externalIde.cursorControlEnabled": {
    schema: z.boolean(),
    default: false,
    description:
      "Allow ORGII to drive a separate Cursor.app instance (with --remote-debugging-port) so prompts typed on a Cursor IDE history session land in Cursor. Spawns an isolated Cursor process the first time it is enabled — your main Cursor never has to relaunch.",
    category: "externalIde",
  },
} as const satisfies Record<string, SettingDefinition>;
