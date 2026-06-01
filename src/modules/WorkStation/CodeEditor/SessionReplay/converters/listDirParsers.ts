/**
 * List-dir parsing utilities for the SessionReplay explore converter.
 *
 * Extracts and normalises plain-text / structured directory listings produced
 * by the Rust backend into a uniform `string[]` of sorted entries, honoring the
 * display cap and safety cap defined in listDirLimits.
 */
import {
  SIMULATOR_LIST_DIR_DISPLAY_CAP,
  SIMULATOR_LIST_DIR_PARSE_SAFETY_CAP,
} from "../listDirLimits";

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Parse plain-text directory listings produced by the Rust backend.
 * Handles formats: `[dir] name`, `[file] name`, and trailing-`/` convention.
 */
function parseTextListDirLines(text: string): string[] {
  const dirLines: string[] = [];
  const fileLines: string[] = [];
  const lines = text.split("\n").filter((line) => line.trim().length > 0);

  for (const raw of lines) {
    const trimmed = raw.trim();
    const bracketMatch = trimmed.match(/^\[(dir|file)\]\s+(.+)$/i);
    if (bracketMatch) {
      const name = bracketMatch[2].trim();
      if (bracketMatch[1].toLowerCase() === "dir") {
        dirLines.push(name.endsWith("/") ? name : `${name}/`);
      } else {
        fileLines.push(name);
      }
      continue;
    }
    if (trimmed.endsWith("/")) {
      dirLines.push(trimmed);
    } else {
      fileLines.push(trimmed);
    }
  }

  dirLines.sort();
  fileLines.sort();
  return [...dirLines, ...fileLines];
}

function extractListDirLinesBeforeDisplayCap(
  result: Record<string, unknown>
): string[] {
  const fromTreeNode = (root: Record<string, unknown>): string[] => {
    const dirLines: string[] = [];
    const fileLines: string[] = [];
    const childrenDirs = root.childrenDirs as
      | Array<Record<string, unknown>>
      | undefined;
    const childrenFiles = root.childrenFiles as
      | Array<Record<string, unknown>>
      | undefined;

    if (Array.isArray(childrenDirs)) {
      childrenDirs.forEach((dir) => {
        const absPath = dir.absPath as string | undefined;
        const baseName =
          (dir.name as string | undefined) ||
          (absPath ? absPath.split("/").filter(Boolean).pop() : undefined);
        if (baseName) {
          dirLines.push(baseName.endsWith("/") ? baseName : `${baseName}/`);
        }
      });
    }
    if (Array.isArray(childrenFiles)) {
      childrenFiles.forEach((file) => {
        const name = file.name as string | undefined;
        if (name) fileLines.push(name);
      });
    }
    dirLines.sort();
    fileLines.sort();
    return [...dirLines, ...fileLines];
  };

  const output = result.output as Record<string, unknown> | string | undefined;

  if (typeof output === "string") {
    const parsed = parseTextListDirLines(output);
    if (parsed.length > 0) {
      return parsed.slice(0, SIMULATOR_LIST_DIR_PARSE_SAFETY_CAP);
    }
  }

  if (output && typeof output === "object") {
    const outputObj = output as Record<string, unknown>;
    const successNested = outputObj.success as
      | Record<string, unknown>
      | undefined;
    const directSuccess = result.success as Record<string, unknown> | undefined;
    const outputTreeRoot = outputObj.directoryTreeRoot as
      | Record<string, unknown>
      | undefined;

    const treeSources: Array<Record<string, unknown> | undefined> = [
      successNested?.directoryTreeRoot as Record<string, unknown> | undefined,
      outputTreeRoot,
      successNested?.childrenDirs || successNested?.childrenFiles
        ? successNested
        : undefined,
      directSuccess?.directoryTreeRoot as Record<string, unknown> | undefined,
      directSuccess?.childrenDirs || directSuccess?.childrenFiles
        ? directSuccess
        : undefined,
    ];

    for (const node of treeSources) {
      if (!node) continue;
      const lines = fromTreeNode(node);
      if (lines.length > 0) {
        return lines.slice(0, SIMULATOR_LIST_DIR_PARSE_SAFETY_CAP);
      }
    }
  }

  const textSources = [result.content, result.observation].filter(
    (src): src is string => typeof src === "string" && src.trim().length > 0
  );
  for (const text of textSources) {
    const parsed = parseTextListDirLines(text);
    if (parsed.length > 0) {
      return parsed.slice(0, SIMULATOR_LIST_DIR_PARSE_SAFETY_CAP);
    }
  }

  return [];
}

// ============================================================================
// Public API
// ============================================================================

export interface ListDirResult {
  files: string[];
  listDirDisplayTruncated: boolean | undefined;
  listDirTotalListedCount: number | undefined;
  listDirParseSafetyCapped: boolean | undefined;
}

export function extractListDirResults(
  result: Record<string, unknown>
): ListDirResult {
  let rawLines = extractListDirLinesBeforeDisplayCap(result);

  if (rawLines.length === 0) {
    const output = result.output as
      | Record<string, unknown>
      | string
      | undefined;
    if (output && typeof output === "object") {
      const successData = output.success as Record<string, unknown> | undefined;
      const rawEntries =
        (successData?.entries as unknown[]) ||
        (successData?.files as unknown[]) ||
        (successData?.items as unknown[]) ||
        (output.entries as unknown[]) ||
        (output.files as unknown[]) ||
        (output.items as unknown[]) ||
        [];
      if (Array.isArray(rawEntries)) {
        rawLines = rawEntries
          .filter((entry): entry is string => typeof entry === "string")
          .slice(0, SIMULATOR_LIST_DIR_PARSE_SAFETY_CAP);
      }
    }
  }

  const listDirParseSafetyCapped =
    rawLines.length >= SIMULATOR_LIST_DIR_PARSE_SAFETY_CAP;
  const listDirTotalListedCount = rawLines.length;
  const listDirDisplayTruncated =
    rawLines.length > SIMULATOR_LIST_DIR_DISPLAY_CAP ||
    listDirParseSafetyCapped;

  return {
    files: rawLines.slice(0, SIMULATOR_LIST_DIR_DISPLAY_CAP),
    listDirDisplayTruncated,
    listDirTotalListedCount,
    listDirParseSafetyCapped,
  };
}
