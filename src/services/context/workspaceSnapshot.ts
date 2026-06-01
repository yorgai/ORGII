/**
 * Snapshot of the current workspace state for agent APIs.
 *
 * Includes editor, git, diagnostics, and workspace folder data.
 * Kept in a dependency-free module so `api/tauri/agent/types` and RPC schemas
 * do not import `collectors/IdeContextCollector` (which pulls Jotai stores).
 */
import type { TechSavvyLevel } from "@src/config/profile/userProfile";
import type { UserPresenceWire } from "@src/types/userPresence";

export interface UserProfileWire {
  techSavvy?: TechSavvyLevel;
  jobRoles?: string[];
  familiarTechStacks?: string[];
  description?: string;
}

export interface WorkspaceSnapshot {
  activeFile?: string;
  openFiles?: string[];
  cursorPosition?: string;
  gitBranch?: string;
  gitStatus?: string;
  gitChangedFiles?: string[];
  linterErrors?: string[];
  workspaceFolders?: string[];
  /**
   * QQ-style availability the user set in the sidebar footer. Shipped on
   * every turn even when there is no IDE data so the agent can adapt to
   * whether the user is online, invisible, or away.
   */
  userPresence?: UserPresenceWire;
  /**
   * User profile preferences from Settings → My Role. Shipped on every turn
   * so the agent can calibrate explanations and examples to the user.
   */
  userProfile?: UserProfileWire;
}
