/**
 * Launchpad Configuration
 *
 * Color palette for repo icons (deterministic from name hash),
 * view types, layout constants, and SDE agent setup prompt builder.
 */
// ============================================
// Setup Prompt Builder
// ============================================
import { REPO_SETUP_PROMPT_MARKER } from "@src/config/repoSetupMarker";

import type { DetectedConfigFile, RepoType } from "./types";

const REPO_COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFEAA7",
  "#DDA0DD",
  "#98D8C8",
  "#F7DC6F",
  "#BB8FCE",
  "#85C1E9",
  "#F0B27A",
  "#82E0AA",
  "#F1948A",
  "#AED6F1",
  "#D7BDE2",
  "#A3E4D7",
] as const;

/**
 * Deterministic color from repo name.
 * Same name always produces the same color.
 */
export function getRepoColor(name: string): string {
  let hash = 0;
  for (let idx = 0; idx < name.length; idx++) {
    hash = (hash * 31 + name.charCodeAt(idx)) | 0;
  }
  return REPO_COLORS[Math.abs(hash) % REPO_COLORS.length];
}

export const GRID_ICON_SIZE = 56;

export { REPO_SETUP_PROMPT_MARKER };

export interface SetupPromptContext {
  repoPath: string;
  repoName: string;
  repoType: RepoType;
  repoTypeLabel: string;
  configFiles: DetectedConfigFile[];
  hasDocker: boolean;
  hasMakefile: boolean;
}

export function buildSetupPrompt(
  context: SetupPromptContext,
  trusted: boolean
): string {
  const configs =
    context.configFiles.length > 0
      ? context.configFiles.map((file) => file.name).join(", ")
      : "none";

  const tools: string[] = [];
  if (context.hasDocker) tools.push("Docker");
  if (context.hasMakefile) tools.push("Make");

  const securityBlock = trusted
    ? ""
    : `\n\n⚠️ UNTRUSTED REPO — Before installing or running anything, scan for security risks: malicious install hooks, obfuscated scripts, unexpected network calls, credential exfiltration. Report findings and wait for approval before proceeding.`;

  const typeBlock =
    context.repoType === "unknown"
      ? `Type: Unknown — start by identifying the project type from directory contents, then proceed with setup.`
      : `Type: ${context.repoTypeLabel}`;

  return `${REPO_SETUP_PROMPT_MARKER}Repo: "${context.repoName}" at ${context.repoPath}
${typeBlock}
Config: ${configs}${tools.length > 0 ? `\nTools: ${tools.join(", ")}` : ""}

Get this app running — install deps, fill missing env vars, fix whatever blocks startup, and launch it.

When there are multiple approaches (e.g. Tauri vs browser-only, conda vs pip, Docker vs native) or risky/destructive steps, ask me which option to take before proceeding.

Once the app is running, call setup_repo with action="launch_app" and include the url (e.g. "http://localhost:3000") if it's a web app. This opens the app automatically in WorkStation.${securityBlock}`;
}
