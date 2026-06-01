/**
 * Hooks for resolving tool labels from the Rust registry.
 *
 * All tool labels (running / done / failed and extra sub-states) are
 * declared in `builtin_tools.rs` on the Rust side and ingested into the
 * runtime registry via `initToolRegistry`. Blocks and adapters must
 * resolve their labels through these helpers so:
 *
 *   1. Renaming a label key requires no frontend code change.
 *   2. Missing labels fail loudly (returning `null` → caller hides the row
 *      or surfaces the key) instead of silently falling back to an
 *      English hardcoded string.
 *
 * Do NOT add `?? "some fallback"` at call sites — missing labels are bugs.
 */
import { useTranslation } from "react-i18next";

import type { EventStatus } from "../types/universalProps";
import { getActionLabels, getToolLabel } from "./initToolRegistry";

/** The three canonical lifecycle states blocks render. */
export type LifecycleState = "running" | "done" | "failed";

/**
 * Map an `EventStatus` to the corresponding lifecycle label key.
 * `"pending"` and `"cancelled"` are treated as failed for label purposes —
 * callers that need finer granularity should use `useToolLabelText`
 * directly with a registry-declared extra state name.
 */
export function statusToLifecycle(status: EventStatus): LifecycleState {
  if (status === "running" || status === "pending") return "running";
  if (status === "success") return "done";
  return "failed";
}

export interface LifecycleLabelKeys {
  running: string | null;
  done: string | null;
  failed: string | null;
}

/**
 * Resolve the full running/done/failed label key triple for a
 * tool invocation. Action-level keys take precedence over tool-level keys;
 * returns `null` for any state the registry does not declare.
 */
function resolveLifecycleLabelKeys(
  toolName: string,
  actionName?: string
): LifecycleLabelKeys {
  const labels = getActionLabels(toolName, actionName);
  if (!labels) {
    return { running: null, done: null, failed: null };
  }
  return {
    running: labels.running || null,
    done: labels.done || null,
    failed: labels.failed || null,
  };
}

export interface LifecycleLabelText {
  running: string;
  done: string;
  failed: string;
}

/**
 * Hook: returns the translated running/done/failed text for a tool.
 *
 * `vars` is forwarded to `t(key, vars)` so labels that use ICU-style
 * interpolation (e.g. `"Reading {{name}}"`) resolve to a concrete string
 * at the adapter layer. Adapters that don't have a name/parameter can
 * omit `vars` entirely.
 *
 * Call sites must NOT concatenate fallbacks — when the registry has no key
 * the corresponding field is an empty string so the block can render
 * nothing (or the key itself in development). Missing keys indicate a
 * Rust-side `labelRunning/Done/Failed` gap that should be filed.
 */
export function useLifecycleLabels(
  toolName: string,
  actionName?: string,
  vars?: Record<string, unknown>
): LifecycleLabelText {
  const { t } = useTranslation("sessions");
  const keys = resolveLifecycleLabelKeys(toolName, actionName);
  return {
    running: keys.running ? t(keys.running, vars) : "",
    done: keys.done ? t(keys.done, vars) : "",
    failed: keys.failed ? t(keys.failed, vars) : "",
  };
}

/**
 * Hook: resolve a single label for an arbitrary state (`"killed"`,
 * `"background"`, `"pattern_matched"`, etc.).
 *
 * `vars` is forwarded to `t(key, vars)` so labels using ICU-style
 * interpolation (e.g. `"Switched to {{mode}} Mode"`) resolve at the
 * adapter layer. Callers without parameters may omit it.
 *
 * Returns an empty string when neither an action-level nor tool-level
 * `status_labels` entry is declared in Rust for `state`.
 */
export function useToolLabelText(
  toolName: string,
  state: string,
  actionName?: string,
  vars?: Record<string, unknown>
): string {
  const { t } = useTranslation("sessions");
  const key = getToolLabel(toolName, state, actionName);
  return key ? t(key, vars) : "";
}
