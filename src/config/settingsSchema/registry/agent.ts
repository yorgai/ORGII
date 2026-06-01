import { z } from "zod";

import type { SettingDefinition } from "@src/config/settingsSchema/types";

/**
 * Agent settings registry.
 *
 * Per-agent backend knobs (model, temperature, compaction, security,
 * runtime, etc.) live on the backend `AgentDefinition`
 * (S3 — `~/.orgii/agent_definitions/<id>.json`) as the single source of
 * truth. They are edited via the AgentOrgs section (which is also
 * embedded into the Settings → Agent tab via slot rendering) and
 * persisted directly through `agent_def_update_patch` / the legacy
 * `update_agent_config` Tauri commands.
 *
 * The settings.jsonc file (S1) intentionally does NOT mirror those
 * backend knobs. If the user opens the JSONC editor they will not see
 * `agent.os.<backend-knob>` or `agent.sde.<backend-knob>` keys — that's
 * by design. Adding them back here would re-introduce the S1 ⇄ S3
 * dual-write split-brain documented as P0-10.
 *
 * The key below is different: it is a pure frontend UX preference
 * consumed by `AskQuestionCard`, not a backend `AgentDefinition` field.
 * The Rust `AgentDefinition` struct has no `question_auto_skip_timeout`
 * field. Storing it in S1 is correct.
 */
export const AGENT_SETTINGS_REGISTRY = {
  "agent.sde.questionAutoSkipTimeout": {
    schema: z.number().int().min(0).max(300),
    default: 0,
    description:
      "Auto-skip agent questions after N seconds (0 = disabled). Frontend-only UX preference; agent decides how to continue.",
    category: "agent",
  },
} as const satisfies Record<string, SettingDefinition>;
