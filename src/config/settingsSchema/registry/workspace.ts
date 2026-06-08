import { z } from "zod";

import type { SettingDefinition } from "@src/config/settingsSchema/types";
import {
  WORKSPACE_DEFAULT_REPO_LOCATION,
  WORKSPACE_DEFAULT_REPO_LOCATION_VALUES,
} from "@src/config/workspaceDefaultRepoPaths";

export const WORKSPACE_SETTINGS_REGISTRY = {
  "workspace.defaultRepoLocation": {
    schema: z.enum(WORKSPACE_DEFAULT_REPO_LOCATION_VALUES),
    default: WORKSPACE_DEFAULT_REPO_LOCATION.DOCUMENTS_ORGII,
    description:
      "Default parent folder used to prefill clone and create repository forms",
    category: "workspace",
    enumLabels: {
      [WORKSPACE_DEFAULT_REPO_LOCATION.DOCUMENTS_GITHUB]: "Documents/GitHub",
      [WORKSPACE_DEFAULT_REPO_LOCATION.DOCUMENTS_ORGII]: "Documents/ORGII",
      [WORKSPACE_DEFAULT_REPO_LOCATION.DOCUMENTS]: "Documents",
      [WORKSPACE_DEFAULT_REPO_LOCATION.CUSTOM]: "Custom",
    },
  },
  "workspace.customDefaultRepoPath": {
    schema: z.string(),
    default: "",
    description:
      'Custom default parent folder used when workspace.defaultRepoLocation is "custom"',
    category: "workspace",
  },
} as const satisfies Record<string, SettingDefinition>;
