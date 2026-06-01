/**
 * exploreResultExtractors
 *
 * Per-tool result extraction functions for the explore converter.
 * Each function reads the raw event args/result and returns typed data
 * ready for rendering. No side-effects; all pure.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { SearchResult } from "../types";
import {
  asRecord,
  extractFilesFromSource,
  extractSearchRowsFromSource,
  extractStringArrayFromSource,
  extractTextFromResult,
  firstString,
  parseTextSearchResults,
} from "./exploreDataHelpers";

// ============================================
// manage_workspace
// ============================================

/**
 * Parse `manage_workspace` output (list / add / remove):
 * "Workspaces (N):\n[git] name → path\n[folder] name → path"
 */
export function extractManageWorkspaceResults(
  result: Record<string, unknown>
): { files: string[]; totalMatches: number } {
  const content =
    (result.content as string) ||
    (result.output as string) ||
    (result.observation as string) ||
    "";

  if (!content || typeof content !== "string") {
    return { files: [], totalMatches: 0 };
  }

  const lines = content.split("\n").filter((line) => line.includes("→"));
  const files = lines.map((line) => {
    const kindMatch = line.match(/^\[(\w+)\]\s*/);
    const kind = kindMatch?.[1] || "git";
    const rest = kindMatch ? line.slice(kindMatch[0].length) : line;
    const [name, ...pathParts] = rest.split("→");
    const path = pathParts.join("→").trim();
    return `[${kind}] ${name.trim()} → ${path}`;
  });

  return { files, totalMatches: files.length };
}

// ============================================
// query_lsp
// ============================================

function parseLspDiagnosticsText(content: string): {
  results: SearchResult[];
  files: string[];
} {
  const results: SearchResult[] = [];
  const files = new Set<string>();
  const seen = new Set<string>();
  let currentFile = "";

  for (const line of content.split("\n")) {
    const fileMatch = line.match(/^Diagnostics for (.+):\s*$/);
    if (fileMatch) {
      currentFile = fileMatch[1].trim();
      if (currentFile) files.add(currentFile);
      continue;
    }

    const diagnosticMatch = line.match(
      /^\s*L(\d+)(?::\d+)?\s+(\[[^\]]+\]\s+.+)$/
    );
    if (!diagnosticMatch || !currentFile) continue;

    const lineNumber = Number.parseInt(diagnosticMatch[1], 10);
    const diagnosticContent = diagnosticMatch[2].trim();
    const dedupeKey = `${currentFile}:${lineNumber}:${diagnosticContent}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    results.push({
      file: currentFile,
      line: lineNumber,
      content: diagnosticContent,
    });
  }

  return { results, files: Array.from(files) };
}

function extractLspCheckedFiles(
  args: Record<string, unknown>,
  result: Record<string, unknown>
): string[] {
  const files = new Set<string>();
  for (const file of extractStringArrayFromSource(args.paths)) {
    files.add(file);
  }
  for (const key of ["path", "file_path", "target_file"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) files.add(value);
  }

  const diagnosticsByFile = Array.isArray(result.linterErrorsByFile)
    ? result.linterErrorsByFile
    : [];
  for (const entry of diagnosticsByFile) {
    const record = asRecord(entry);
    if (!record) continue;
    const filePath = firstString(record, [
      "relativeWorkspacePath",
      "filePath",
      "file_path",
      "path",
      "uri",
    ]);
    if (filePath) files.add(filePath);
  }

  return [...files];
}

export function extractLspResults(
  args: Record<string, unknown>,
  result: Record<string, unknown>
): { results: SearchResult[]; files: string[]; totalMatches: number } {
  const standardData = extractStandardSearchResults(result);
  if (standardData.results.length > 0) {
    return {
      results: standardData.results,
      files: [
        ...new Set(standardData.results.map((row) => row.file).filter(Boolean)),
      ],
      totalMatches: standardData.totalMatches,
    };
  }

  const content = extractTextFromResult(result);
  if (content.trim().length > 0) {
    const parsedDiagnostics = parseLspDiagnosticsText(content);
    if (parsedDiagnostics.results.length > 0) {
      return {
        results: parsedDiagnostics.results,
        files: parsedDiagnostics.files,
        totalMatches: parsedDiagnostics.results.length,
      };
    }

    const filePath =
      (args.file_path as string) || (args.path as string) || "lsp";
    return {
      results: [{ file: filePath, line: 0, content }],
      files: filePath ? [filePath] : [],
      totalMatches: 1,
    };
  }

  const checkedFiles = extractLspCheckedFiles(args, result);
  if (checkedFiles.length > 0) {
    const contentLines = [
      "Checked files:",
      ...checkedFiles.map((file) => `- ${file}`),
      "",
      "No diagnostics returned.",
    ];
    return {
      results: [
        {
          file: checkedFiles[0],
          line: 0,
          content: contentLines.join("\n"),
        },
      ],
      files: checkedFiles,
      totalMatches: checkedFiles.length,
    };
  }

  return { results: [], files: [], totalMatches: 0 };
}

// ============================================
// cat
// ============================================

export function extractCatResults(
  args: Record<string, unknown>,
  result: Record<string, unknown>
): { results: SearchResult[]; totalMatches: number } {
  const output = result.output as Record<string, unknown> | undefined;
  const successData = (output?.success as Record<string, unknown>) || {};
  const content =
    (successData?.content as string) ||
    (result?.content as string) ||
    (result?.file_content as string) ||
    "";
  if (content) {
    return {
      results: [
        {
          file:
            (args.file_path as string) || (args.target_file as string) || "",
          line: 0,
          content: content.slice(0, 500) + (content.length > 500 ? "..." : ""),
        },
      ],
      totalMatches: 1,
    };
  }
  return { results: [], totalMatches: 0 };
}

// ============================================
// glob / file_search
// ============================================

export function extractGlobResults(
  event: SessionEvent,
  result: Record<string, unknown>
): { files: string[]; totalMatches: number } {
  const extracted = event.extracted;
  if (extracted && extracted.kind === "glob") {
    const total =
      typeof extracted.totalFiles === "number" && extracted.totalFiles > 0
        ? extracted.totalFiles
        : extracted.files.length;
    return { files: extracted.files, totalMatches: total };
  }

  const standardData = extractStandardSearchResults(result);
  return {
    files: standardData.files,
    totalMatches:
      standardData.totalMatches > 0
        ? standardData.totalMatches
        : standardData.files.length,
  };
}

// ============================================
// grep / code_search / symbols (generic search)
// ============================================

export function extractSearchResults(
  event: SessionEvent,
  result: Record<string, unknown>
): { results: SearchResult[]; files: string[]; totalMatches: number } {
  const extracted = event.extracted;
  if (extracted && extracted.kind === "search") {
    const results = extracted.results.map((hit) => ({
      file: hit.file,
      line: hit.line,
      content: hit.content,
    }));
    const total =
      typeof extracted.totalMatches === "number" && extracted.totalMatches > 0
        ? extracted.totalMatches
        : results.length;
    return { results, files: [], totalMatches: total };
  }

  return extractStandardSearchResults(result);
}

// ============================================
// Standard / fallback search result extractor
// ============================================

export function extractStandardSearchResults(result: Record<string, unknown>): {
  results: SearchResult[];
  files: string[];
  totalMatches: number;
} {
  const outputData = result.output as Record<string, unknown> | undefined;
  const successData = outputData?.success as
    | Record<string, unknown>
    | undefined;
  const directSuccess = result.success as Record<string, unknown> | undefined;
  const cursorAdditionalData = result.cursorAdditionalData as
    | Record<string, unknown>
    | undefined;

  let parsedObservation: Record<string, unknown> | null = null;
  if (typeof result.observation === "string") {
    try {
      const jsonStr = (result.observation as string).replace(/'/g, '"');
      parsedObservation = JSON.parse(jsonStr);
    } catch {
      // Not valid JSON
    }
  }

  const filesFromParsedObservation = (
    parsedObservation?.success as Record<string, unknown>
  )?.files as string[] | undefined;

  type RawSearchResult = { file: string; line: number; content: string };
  const rawResults =
    (result.results as RawSearchResult[]) ||
    (result.matches as RawSearchResult[]) ||
    (successData?.results as RawSearchResult[]) ||
    (directSuccess?.results as RawSearchResult[]) ||
    (outputData?.results as RawSearchResult[]) ||
    [];

  let results: SearchResult[] = [];
  let files: string[] = [];
  let totalMatches = 0;

  if (Array.isArray(rawResults)) {
    results = rawResults
      .filter(
        (r) => r && typeof r.file === "string" && typeof r.line === "number"
      )
      .map((r) => ({
        file: r.file,
        line: r.line,
        content: (r.content as string) || "",
      }));
    totalMatches = results.length;
  }

  const fileSources = [
    result.files,
    successData?.files,
    directSuccess?.files,
    result.directories,
    result.matches,
    result.topFiles,
    cursorAdditionalData?.topFiles,
    result.content,
    result.items,
    filesFromParsedObservation,
  ];
  for (const source of fileSources) {
    const extracted = extractStringArrayFromSource(source);
    const extractedFromObjects =
      extracted.length > 0 ? extracted : extractFilesFromSource(source);
    if (extractedFromObjects.length > 0) {
      files = extractedFromObjects;
      totalMatches = files.length;
      break;
    }
  }

  if (results.length === 0) {
    const structuredSources = [
      result.results,
      result.matches,
      result.topFiles,
      cursorAdditionalData?.topFiles,
      result.content,
      result.items,
      successData?.results,
      successData?.content,
      directSuccess?.results,
      directSuccess?.content,
      outputData?.results,
      outputData?.content,
    ];
    for (const source of structuredSources) {
      const extractedRows = extractSearchRowsFromSource(source);
      if (extractedRows.length > 0) {
        results = extractedRows;
        totalMatches = extractedRows.length;
        break;
      }
    }
  }

  if (results.length === 0 && files.length === 0) {
    const textContent = extractTextFromResult(result);
    if (textContent) {
      const { results: parsed, files: parsedFiles } =
        parseTextSearchResults(textContent);
      if (parsed.length > 0) {
        results = parsed;
        totalMatches = parsed.length;
      } else if (parsedFiles.length > 0) {
        files = parsedFiles;
        totalMatches = parsedFiles.length;
      }
    }
  }

  const parsedSuccess = parsedObservation?.success as
    | Record<string, unknown>
    | undefined;
  if (typeof result.totalMatches === "number") {
    totalMatches = result.totalMatches;
  } else if (typeof successData?.totalMatches === "number") {
    totalMatches = successData.totalMatches as number;
  } else if (typeof result.totalFiles === "number") {
    totalMatches = result.totalFiles;
  } else if (typeof cursorAdditionalData?.totalMatches === "number") {
    totalMatches = cursorAdditionalData.totalMatches as number;
  } else if (typeof cursorAdditionalData?.totalFiles === "number") {
    totalMatches = cursorAdditionalData.totalFiles as number;
  } else if (typeof successData?.totalFiles === "number") {
    totalMatches = successData.totalFiles as number;
  } else if (typeof parsedSuccess?.totalFiles === "number") {
    totalMatches = parsedSuccess.totalFiles as number;
  }

  return { results, files, totalMatches };
}
