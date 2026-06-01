/**
 * Result parsing helpers — extract structured data from raw tool result objects.
 */
import { isBrowserTool } from "@src/engines/SessionCore/rendering/registry/toolCategories";

import {
  formatDurationShort,
  readAwaitMetaFromResult,
} from "../../../rendering/adapters/awaitMeta";
import type {
  BackgroundJobRow,
  ProjectToolListRow,
  WorkspaceEntry,
  WorkspaceInfoRow,
} from "../types";
import { extractScreenshotIds, stripScreenshotMarkers } from "./argsSummary";

/**
 * Try to parse a JSON string that contains structured browser tool output.
 * Returns { text, screenshot, url } if it's a browser JSON result, null otherwise.
 */
function parseBrowserJsonResult(
  value: string
): { text: string; screenshot?: string; url?: string } | null {
  if (!value.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.text === "string") {
      return {
        text: parsed.text,
        screenshot:
          typeof parsed.screenshot === "string"
            ? (parsed.screenshot as string)
            : undefined,
        url:
          typeof parsed.url === "string" ? (parsed.url as string) : undefined,
      };
    }
  } catch {
    // Not JSON
  }
  return null;
}

export function extractResultText(
  result: Record<string, unknown>
): string | null {
  const textFields = [
    "content",
    "observation",
    "output",
    "message",
    "stdout",
    "data",
    "response",
  ];

  for (const field of textFields) {
    const val = result[field];
    if (typeof val === "string" && val.trim().length > 0) {
      const browserResult = parseBrowserJsonResult(val);
      if (browserResult) return browserResult.text;
      return stripScreenshotMarkers(val);
    }
  }

  const errorVal = result.error || result.error_message;
  if (typeof errorVal === "string" && errorVal.trim().length > 0) {
    return errorVal.trim();
  }

  return null;
}

export function extractScreenshot(
  result: Record<string, unknown>,
  screenshotCache?: Map<string, string>
): string | null {
  if (typeof result.screenshot === "string" && result.screenshot.length > 100) {
    return result.screenshot as string;
  }
  const output = result.output;
  if (typeof output === "string") {
    const parsed = parseBrowserJsonResult(output);
    if (parsed?.screenshot) return parsed.screenshot;
  }

  if (screenshotCache) {
    for (const field of ["content", "output", "observation"]) {
      const val = result[field];
      if (typeof val !== "string") continue;
      const ids = extractScreenshotIds(val);
      for (const id of ids) {
        const cached = screenshotCache.get(id);
        if (cached) return cached;
      }
    }
  }

  return null;
}

export function isErrorResult(result: Record<string, unknown>): boolean {
  if (result.success === false || result.is_error === true) return true;
  if (result.error || result.error_message) return true;

  const text =
    (result.content as string) || (result.observation as string) || "";
  if (typeof text === "string" && /^error[:\s]/i.test(text)) return true;

  return false;
}

export function hasNonEmptyResultValues(
  result: Record<string, unknown>
): boolean {
  for (const val of Object.values(result)) {
    if (val === null || val === undefined) continue;
    if (typeof val === "string" && val.trim().length === 0) continue;
    return true;
  }
  return false;
}

export function isBrowserSnapshotResult(
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>
): boolean {
  const isSnapshot =
    args.action === "snapshot" || toolName === "browser_snapshot";
  return (
    isBrowserTool(toolName) &&
    isSnapshot &&
    typeof result.content === "string" &&
    result.content.length > 100
  );
}

export function parseSearchFilesResult(text: string): string[] | null {
  if (text === "No files found.") return [];
  const lines = text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => !line.startsWith("Watched"));
  if (lines.length === 0) return null;
  if (lines.every((line) => line.includes("/") || line.includes("\\")))
    return lines;
  return null;
}

/**
 * Parse `manage_workspace` output lines of the form `[kind] name → path`.
 */
export function parseManageWorkspaceResult(
  text: string
): WorkspaceEntry[] | null {
  if (!text.includes("→")) return null;
  const lines = text.split("\n").filter((line) => line.includes("→"));
  if (lines.length === 0) return null;
  return lines.map((line) => {
    const kindMatch = line.match(/^\[(\w+)\]\s*/);
    const kind: "git" | "folder" =
      kindMatch?.[1] === "folder" ? "folder" : "git";
    const rest = kindMatch ? line.slice(kindMatch[0].length) : line;
    const [name, ...pathParts] = rest.split("→");
    return { name: name.trim(), path: pathParts.join("→").trim(), kind };
  });
}

export function parseProjectToolListResult(
  text: string,
  toolName: string,
  args: Record<string, unknown>
): ProjectToolListRow[] | null {
  const action = typeof args.action === "string" ? args.action : "";
  if (!isProjectToolRowAction(toolName, action)) return null;

  if (/^No (projects|work items|results) found/i.test(text.trim())) return null;

  const mutationRow = parseProjectToolMutationLine(text.trim(), action, args);
  if (mutationRow) return [mutationRow];

  const rows = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => parseProjectToolListLine(line))
    .filter((row): row is ProjectToolListRow => row !== null);

  return rows.length > 0 ? rows : null;
}

function isProjectToolRowAction(toolName: string, action: string): boolean {
  if (toolName === "manage_work_item") {
    return [
      "list",
      "list_items",
      "create",
      "create_item",
      "update",
      "update_item",
      "delete",
      "delete_item",
    ].includes(action);
  }
  if (toolName !== "manage_story") return false;
  return [
    "list",
    "list_items",
    "find",
    "create",
    "create_item",
    "update",
    "update_item",
    "delete",
    "delete_item",
  ].includes(action);
}

function parseProjectToolMutationLine(
  line: string,
  action: string,
  args: Record<string, unknown>
): ProjectToolListRow | null {
  const change = getProjectToolChange(action);
  if (!change) return null;

  const workItemMatch = line.match(/work item '([^']+)' \[([^\]]+)\]/i);
  if (workItemMatch) return { name: workItemMatch[1].trim(), change };

  const projectMatch = line.match(/project '([^']+)'/i);
  if (projectMatch) return { name: projectMatch[1].trim(), change };

  const argsMatch = line.match(/\[([^\]]+)\]/);
  if (argsMatch) return { name: argsMatch[1].trim(), change };

  const argsName = extractProjectToolMutationName(args);
  return argsName ? { name: argsName, change } : null;
}

function extractProjectToolMutationName(args: Record<string, unknown>): string {
  const candidates = [
    args.title,
    args.name,
    args.short_id,
    args.slug,
    args.project_slug,
  ];
  const name = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0
  );
  return name?.trim() ?? "";
}

function getProjectToolChange(action: string): ProjectToolListRow["change"] {
  if (action === "create" || action === "create_item") return "added";
  if (action === "update" || action === "update_item") return "updated";
  if (action === "delete" || action === "delete_item") return "deleted";
  return undefined;
}

function parseProjectToolListLine(line: string): ProjectToolListRow | null {
  const bullet = line.replace(/^-\s+/, "");
  const workItemMatch = bullet.match(/^\*\*(.*?)\*\*\s+\[([^\]]+)\]/);
  if (workItemMatch) {
    return { name: workItemMatch[1].trim() };
  }

  const findWorkItemMatch = bullet.match(/^\[([^\]]+)\]\s+"([^"]+)"/);
  if (findWorkItemMatch) {
    return { name: findWorkItemMatch[2].trim() };
  }

  const projectMatch = bullet.match(/^\*\*(.*?)\*\*/);
  if (projectMatch) {
    return { name: projectMatch[1].trim() };
  }

  const findProjectMatch = bullet.match(/^(.*?)\s+\(slug:\s*[^)]+\)/);
  if (findProjectMatch) {
    return { name: findProjectMatch[1].trim() };
  }

  return null;
}

function compact(
  rows: Array<WorkspaceInfoRow | false | "" | null | undefined>
): WorkspaceInfoRow[] {
  return rows.filter((row): row is WorkspaceInfoRow => Boolean(row));
}

/**
 * Build key/value rows for the `manage_workspace` Info block from the
 * tool-call args for a single mutation action.
 */
export function buildWorkspaceInfoRows(
  args: Record<string, unknown>
): WorkspaceInfoRow[] | null {
  const action = typeof args.action === "string" ? args.action : "";
  const path = typeof args.path === "string" ? args.path : "";
  const url = typeof args.url === "string" ? args.url : "";
  const targetDir = typeof args.target_dir === "string" ? args.target_dir : "";
  const name = typeof args.name === "string" ? args.name : "";
  const repoId = typeof args.repo_id === "string" ? args.repo_id : "";
  const git = args.git !== false;

  switch (action) {
    case "add":
      return compact([
        { key: "operation", label: "Operation", value: "Add local repo" },
        path && { key: "path", label: "Path", value: path },
        name && { key: "name", label: "Name", value: name },
      ]);
    case "clone":
      return compact([
        { key: "operation", label: "Operation", value: "Clone from GitHub" },
        url && { key: "url", label: "URL", value: url },
        targetDir && {
          key: "target_dir",
          label: "Target dir",
          value: targetDir,
        },
        name && { key: "name", label: "Name", value: name },
      ]);
    case "create":
      return compact([
        {
          key: "operation",
          label: "Operation",
          value: git ? "Create git repo" : "Create folder",
        },
        path && { key: "path", label: "Path", value: path },
        name && { key: "name", label: "Name", value: name },
      ]);
    case "remove":
      return compact([
        { key: "operation", label: "Operation", value: "Remove workspace" },
        path && { key: "path", label: "Path", value: path },
        !path && repoId && { key: "repo_id", label: "Repo ID", value: repoId },
      ]);
    default:
      return null;
  }
}

/**
 * Extract `BackgroundJobRow[]` from an `await_output(command=list)` result.
 */
export function parseAwaitListingResult(
  result: Record<string, unknown>
): BackgroundJobRow[] | null {
  const meta = readAwaitMetaFromResult(result);
  if (!meta || meta.command !== "list" || !Array.isArray(meta.listItems)) {
    return null;
  }
  return meta.listItems.map((item) => {
    const jobKind: BackgroundJobRow["jobKind"] =
      item.kind === "subagent" ? "subagent" : "shell";
    const status: BackgroundJobRow["status"] =
      item.status === "succeeded"
        ? "succeeded"
        : item.status === "failed"
          ? "failed"
          : "running";
    return {
      handle: item.handle,
      jobKind,
      status,
      ageLabel: formatDurationShort(item.ageMs) || "0s",
      label: item.label,
    };
  });
}
