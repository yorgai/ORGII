import { z } from "zod";

import type { SettingDefinition } from "@src/config/settingsSchema/types";

export const NETWORK_SETTINGS_REGISTRY = {
  "network.httpVersion": {
    schema: z.enum(["auto", "http1", "http2"]),
    default: "auto" as const,
    description: "HTTP protocol for LLM connections and requests",
    category: "network",
    enumLabels: {
      auto: "Auto (recommended)",
      http1: "HTTP/1.1 only",
      http2: "HTTP/2 only",
    },
  },
} as const satisfies Record<string, SettingDefinition>;
