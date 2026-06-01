export type {
  AgentAction,
  AgentEnvConfig,
  AvailableAgent,
  CliInstallMethod,
} from "./types";
export type { CliInstallMethod as InstallMethod } from "./types";

/** Human-readable labels for install method IDs returned by the Rust backend. */
export const METHOD_DISPLAY_LABELS: Record<string, string> = {
  homebrew: "Homebrew",
  npm: "npm",
  pip: "pip / pipx",
  cargo: "Cargo",
  curl: "curl",
  snap: "Snap",
  native: "Native",
  scoop: "Scoop",
};
