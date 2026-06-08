/**
 * RepoDetail shared config — status styling and category options.
 *
 * Shared repo detail status and category config.
 */
import {
  SCRIPT_CATEGORIES,
  type ScriptCategory,
  type SetupStatus,
} from "@src/modules/shared/launchpad/types";

export const STATUS_DOT_COLOR: Record<SetupStatus, string> = {
  not_analyzed: "bg-danger-6",
  no_env_config: "bg-text-4",
  ready: "bg-success-6",
  params_missing: "bg-warning-6",
};

export const STATUS_TEXT_COLOR: Record<SetupStatus, string> = {
  not_analyzed: "text-danger-6",
  no_env_config: "text-text-3",
  ready: "text-success-6",
  params_missing: "text-warning-6",
};

export const STATUS_LABEL_KEY: Record<SetupStatus, string> = {
  not_analyzed: "launchpad.preview.statusNotAnalyzed",
  no_env_config: "launchpad.preview.statusNoEnvConfig",
  ready: "launchpad.preview.statusReady",
  params_missing: "launchpad.preview.statusParamsMissing",
};

export const CATEGORY_OPTIONS: { value: ScriptCategory; label: string }[] =
  Object.keys(SCRIPT_CATEGORIES).map((key) => ({
    value: key as ScriptCategory,
    label: key.charAt(0).toUpperCase() + key.slice(1),
  }));
