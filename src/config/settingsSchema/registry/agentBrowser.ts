import { z } from "zod";

import type { SettingDefinition } from "@src/config/settingsSchema/types";

export const AGENT_BROWSER_PROVIDER = {
  AGENT_BROWSER: "agent_browser",
  PLAYWRIGHT: "playwright",
} as const;

export type AgentBrowserProviderSetting =
  (typeof AGENT_BROWSER_PROVIDER)[keyof typeof AGENT_BROWSER_PROVIDER];

export const AGENT_BROWSER_PROVIDER_VALUES = [
  AGENT_BROWSER_PROVIDER.AGENT_BROWSER,
  AGENT_BROWSER_PROVIDER.PLAYWRIGHT,
] as const;

export const AGENT_BROWSER_SETTING_KEYS = {
  PROVIDER: "agentBrowser.provider",
  AGENT_BROWSER_CLI_PATH: "agentBrowser.agentBrowserCliPath",
  PLAYWRIGHT_CLI_PATH: "agentBrowser.playwrightCliPath",
} as const;

export const AGENT_BROWSER_SETTINGS_REGISTRY = {
  [AGENT_BROWSER_SETTING_KEYS.PROVIDER]: {
    schema: z.enum(AGENT_BROWSER_PROVIDER_VALUES),
    default: AGENT_BROWSER_PROVIDER.AGENT_BROWSER,
    description:
      "Computer Use browser CLI provider used by agent browser tools. Changes require restarting ORGII",
    category: "agentBrowser",
    enumLabels: {
      [AGENT_BROWSER_PROVIDER.AGENT_BROWSER]: "Agent Browser CLI",
      [AGENT_BROWSER_PROVIDER.PLAYWRIGHT]: "Playwright CLI",
    },
  },
  [AGENT_BROWSER_SETTING_KEYS.AGENT_BROWSER_CLI_PATH]: {
    schema: z.string(),
    default: "",
    description:
      "Optional path to the Agent Browser CLI binary. Leave empty to resolve from the vendored binary or PATH. Changes require restarting ORGII",
    category: "agentBrowser",
  },
  [AGENT_BROWSER_SETTING_KEYS.PLAYWRIGHT_CLI_PATH]: {
    schema: z.string(),
    default: "",
    description:
      "Optional path to the Playwright CLI command or script. Leave empty to resolve from the development checkout or PATH. Changes require restarting ORGII",
    category: "agentBrowser",
  },
} as const satisfies Record<string, SettingDefinition>;
