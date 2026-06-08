/**
 * toolSource — derive a jump-to-source target (file path + optional line)
 * from a tool call's arguments.
 *
 * Used by ToolResultActions to render an "open source" button only when the
 * tool actually references a concrete file on disk.
 */

/** A resolved jump-to-source target for a tool call. */
export interface ToolSourceTarget {
  path: string;
  /** 1-based line, when the tool args carry one. */
  line?: number;
}

const FILE_PATH_KEYS = [
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "path",
  "absolute_path",
  "absolutePath",
] as const;

/**
 * Tools whose `path` argument refers to a workspace / directory / entity
 * identifier rather than a concrete source file. Showing an "open source
 * file" jump button for these is misleading — for `manage_workspace.remove`
 * the path no longer exists in our records, for `manage_agent_def` the
 * `path` is an agent id, etc.
 */
const TOOLS_WITHOUT_SOURCE_JUMP = new Set<string>([
  "manage_workspace",
  "manage_agent_def",
  "manage_secrets",
  "manage_project",
  "manage_work_item",
  "manage_story",
  "manage_story_list",
  "manage_file_history",
  "setup_repo",
  "worktree",
  "write_env_file",
]);

const LINE_KEYS = [
  "line",
  "line_number",
  "lineNumber",
  "start_line",
  "startLine",
] as const;

function pickString(
  args: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function pickLine(args: Record<string, unknown>): number | undefined {
  for (const key of LINE_KEYS) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return undefined;
}

/**
 * Extract the source file (and optional line) a tool call points at.
 * Returns `null` when the tool has no file-path argument — search/shell/
 * web tools and the like never produce a jump target — or when the tool
 * is in `TOOLS_WITHOUT_SOURCE_JUMP` (its `path` argument is a workspace,
 * directory, or entity id, not a source file).
 */
export function extractToolSource(
  toolName: string,
  args: Record<string, unknown> | undefined
): ToolSourceTarget | null {
  if (!args) return null;
  if (TOOLS_WITHOUT_SOURCE_JUMP.has(toolName)) return null;
  const path = pickString(args, FILE_PATH_KEYS);
  if (!path) return null;
  return { path, line: pickLine(args) };
}
