/**
 * Repository (Workspace) Actions — Zod-based
 *
 * Actions for managing orgii workspaces (git repositories and plain work
 * folders): list, import existing, clone from remote, create new, remove.
 *
 * Shares the exact same backend path as the agent's native `manage_workspace`
 * tool — both go through the Rust `repo_service` layer via Tauri commands.
 *
 * Layer: `"action"` — pure logic with a native Rust tool equivalent
 * (`manage_workspace`). These actions are NOT exposed to the OS agent via
 * `ide` (the agent is expected to use the native tool). They exist so that
 * human UI (spotlight "Add Repo" flow, settings page) can dispatch through
 * the same unified ActionSystem as every other part of the app — and so that
 * the future cowork / voice mode can reuse them.
 */
import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import { repoApi } from "@src/api/tauri/repo";

// ============================================
// Schemas
// ============================================

const RepoKindSchema = z.enum(["git", "folder"]);

const RepoRecordSchema = z.object({
  repo_id: z.string(),
  user_id: z.string(),
  name: z.string(),
  path: z.string(),
  kind: RepoKindSchema,
  visibility: z.enum(["public", "private"]).optional(),
});

// ============================================
// Actions
// ============================================

export const repoList = defineZodAction(
  {
    id: ACTION_ID.REPO_LIST,
    category: "repo",
    description: "List all tracked workspaces (git repos and work folders)",
    layer: "action",
    params: z.object({}),
    examples: ["list repos", "list workspaces", "show projects"],
  },
  async () => {
    const response = await repoApi.getRepos();
    const repos = response.data.repos;
    return {
      success: true,
      message: `Found ${repos.length} workspace${repos.length === 1 ? "" : "s"}`,
      data: repos,
    };
  }
);

export const repoImport = defineZodAction(
  {
    id: ACTION_ID.REPO_IMPORT,
    category: "repo",
    description:
      "Register an existing local directory as a workspace. Auto-detects whether the directory is a git repository (runs git init when not)",
    layer: "action",
    params: z.object({
      path: z.string().min(1).describe("Absolute path to the directory"),
      asFolder: z
        .boolean()
        .optional()
        .describe(
          "When true, import as a plain work folder (no git). Defaults to auto-detect"
        ),
    }),
    examples: ["import repo", "add local folder", "track this project"],
  },
  async ({ path, asFolder }) => {
    const response = asFolder
      ? await repoApi.importWorkFolder({ fs_path: path })
      : await repoApi.importLocalRepo({ fs_path: path });
    return {
      success: true,
      message: `Imported workspace "${response.data.name}"`,
      data: RepoRecordSchema.parse(response.data),
    };
  }
);

export const repoClone = defineZodAction(
  {
    id: ACTION_ID.REPO_CLONE,
    category: "repo",
    description:
      "Clone a remote git repository into target_dir/<name> and register the clone as a workspace. Uses the user's configured git credentials",
    layer: "action",
    params: z.object({
      url: z.string().min(1).describe("Remote repository URL (HTTPS or SSH)"),
      targetDir: z
        .string()
        .min(1)
        .describe("Parent directory where the clone will be placed"),
    }),
    examples: ["clone repo", "git clone this", "download github repo"],
  },
  async ({ url, targetDir }) => {
    const response = await repoApi.createFromGithub({
      github_url: url,
      fs_path: targetDir,
    });
    return {
      success: true,
      message: `Cloned workspace "${response.data.name}"`,
      data: RepoRecordSchema.parse(response.data),
    };
  }
);

export const repoCreate = defineZodAction(
  {
    id: ACTION_ID.REPO_CREATE,
    category: "repo",
    description:
      "Create a new empty workspace. Creates the directory and either runs `git init` (default) or registers it as a plain work folder",
    layer: "action",
    params: z.object({
      path: z
        .string()
        .min(1)
        .describe("Absolute path where the new workspace should live"),
      name: z.string().min(1).describe("Display name for the new workspace"),
      git: z
        .boolean()
        .optional()
        .describe("When true (default) initialise as a git repo"),
    }),
    examples: ["create new repo", "make a project", "new workspace"],
  },
  async ({ path, name, git = true }) => {
    const response = git
      ? await repoApi.createEmptyRepo({ name, fs_path: path })
      : await repoApi.createWorkFolder({ name, fs_path: path });
    return {
      success: true,
      message: `Created workspace "${response.data.name}"`,
      data: RepoRecordSchema.parse(response.data),
    };
  }
);

export const repoRemove = defineZodAction(
  {
    id: ACTION_ID.REPO_REMOVE,
    category: "repo",
    description: "Remove linkage to ORGII. Nothing is removed from disk.",
    layer: "action",
    params: z.object({
      repoId: z.string().min(1).describe("Repo identifier (canonical path)"),
    }),
    examples: ["remove from ORGII", "delink from ORGII", "untrack workspace"],
  },
  async ({ repoId }) => {
    await repoApi.deleteRepo(repoId);
    return {
      success: true,
      message: "Removed linkage to ORGII",
    };
  }
);

// ============================================
// Export registry
// ============================================

export const repoZodActions = [
  repoList,
  repoImport,
  repoClone,
  repoCreate,
  repoRemove,
];
