/**
 * Search / list_dir / cat / grep result bodies for session replay CodePanel.
 */
import { Code2 } from "lucide-react";
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import FileTypeIcon from "@src/components/FileTypeIcon";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { getToolDisplayLabelFromRegistry } from "@src/util/ui/rendering/registryToolLabel";

import { SIMULATOR_LIST_DIR_DISPLAY_CAP } from "../listDirLimits";
import type { ExploreOperationEntry, SearchResult } from "../types";
import { SessionReplayCodeMirrorViewer } from "./SessionReplayCodeMirrorViewer";
import { searchSnippetOneLine } from "./pathUtils";
import { SEARCH_ROW_ICON_CLASS } from "./searchIcons";
import {
  DiagnosticRow,
  DirectorySummaryHeader,
  ExploreResultRow,
  LspSummaryHeader,
  SearchSummaryHeader,
} from "./searchResultsComponents";
import {
  parseDiagnosticContent,
  parseMatchCountText,
} from "./searchResultsParsers";

export const SearchResultsContent: React.FC<{
  operation: ExploreOperationEntry;
}> = memo(({ operation }) => {
  const { t } = useTranslation();
  const { t: tSessions } = useTranslation("sessions");
  const {
    exploreType,
    exploreAction,
    query: _query,
    results,
    files,
    totalMatches,
    directory: workspaceDirectoryHint,
    isLoading,
  } = operation;

  if (isLoading) {
    return (
      <div className="flex min-h-0 min-h-full w-full min-w-0 flex-1 flex-col">
        <Placeholder
          variant="loading"
          placement="detail-panel"
          fillParentHeight
        />
      </div>
    );
  }

  if (exploreType === "list_dir") {
    const fileList = files ?? [];
    const fileCount = totalMatches > 0 ? totalMatches : fileList.length;
    const showTruncationHint = Boolean(operation.listDirDisplayTruncated);
    return (
      <div className="flex w-full min-w-0 flex-col">
        <DirectorySummaryHeader
          directory={workspaceDirectoryHint}
          countLabel={tSessions("simulator.replay.ide.codePanel.resultCount", {
            count: fileCount,
          })}
        />
        {fileList.length > 0 ? (
          <div className="flex w-full min-w-0 flex-col gap-0.5 p-2">
            {fileList.map((file, idx) => (
              <div
                key={idx}
                className="flex w-full min-w-0 max-w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-fill-2"
              >
                <FileTypeIcon
                  fileName={file}
                  size="small"
                  className={SEARCH_ROW_ICON_CLASS}
                />
                <span
                  className="min-w-0 flex-1 truncate text-text-1"
                  title={file}
                >
                  {file}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {showTruncationHint ? (
          <p className="border-t border-border-2 px-3 py-2 text-[12px] leading-snug text-text-3">
            {operation.listDirParseSafetyCapped
              ? t("placeholders.listDirParseSafetyHint", {
                  maxShown: SIMULATOR_LIST_DIR_DISPLAY_CAP,
                })
              : t("placeholders.listDirTruncatedHint", {
                  maxShown: SIMULATOR_LIST_DIR_DISPLAY_CAP,
                  total: operation.listDirTotalListedCount ?? fileList.length,
                })}
          </p>
        ) : null}
      </div>
    );
  }

  if (exploreType === "cat" && results.length > 0) {
    const content = results[0].content;
    const filePath = results[0].file;
    return (
      <div className="h-full min-h-0 w-full min-w-0 overflow-hidden">
        <SessionReplayCodeMirrorViewer
          content={content}
          filePath={filePath}
          language="text"
        />
      </div>
    );
  }

  if (exploreType === "glob" || exploreType === "file_search") {
    const fileList = files ?? [];
    const fileCount = totalMatches > 0 ? totalMatches : fileList.length;
    return (
      <div className="flex w-full min-w-0 flex-col">
        <SearchSummaryHeader
          query={_query}
          directory={workspaceDirectoryHint}
          toolLabel={getToolDisplayLabelFromRegistry(
            "code_search",
            exploreType === "file_search" ? "find_files" : "glob"
          )}
          countLabel={tSessions("simulator.replay.ide.codePanel.resultCount", {
            count: fileCount,
          })}
        />
        {fileList.length > 0 ? (
          <div className="flex w-full min-w-0 flex-col gap-0.5 p-2">
            {fileList.map((file, idx) => (
              <ExploreResultRow
                key={`${file}-${idx}`}
                filePath={file}
                workspaceDirectoryHint={workspaceDirectoryHint}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  // manage_workspace: display workspace entries matching chat panel style
  // (shared across list / add / remove actions — each emits the same
  // `[kind] name → path` line format)
  if (exploreType === "manage_workspace" && files && files.length > 0) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-0.5 p-2">
        {files.map((entry, idx) => {
          // Format: "[git] name → path" or "[folder] name → path"
          const kindMatch = entry.match(/^\[(\w+)\]\s*/);
          const isGit = kindMatch?.[1] === "git";
          const rest = kindMatch ? entry.slice(kindMatch[0].length) : entry;
          const [name, ...pathParts] = rest.split("→");
          const path = pathParts.join("→").trim();

          return (
            <div
              key={idx}
              className="flex w-full min-w-0 max-w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-fill-2"
            >
              {isGit ? (
                <Code2 size={14} className="flex-shrink-0 text-primary-6" />
              ) : (
                <FileTypeIcon
                  fileName={name.trim()}
                  type="folder"
                  size="small"
                  className={SEARCH_ROW_ICON_CLASS}
                />
              )}
              <span className="flex-shrink-0 font-medium text-text-1">
                {name.trim()}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-[12px] text-text-3"
                title={path}
              >
                {path}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  if (exploreType === "query_lsp") {
    const fileList = files ?? [];
    const checkedFilesOnly =
      results.length === 1 &&
      results[0].line === 0 &&
      results[0].content.includes("No diagnostics returned.");
    const diagnosticCount = checkedFilesOnly
      ? 0
      : totalMatches > 0
        ? totalMatches
        : results.length;
    const displayFilePath = fileList[0] || results[0]?.file;

    return (
      <div className="flex w-full min-w-0 flex-col">
        <LspSummaryHeader
          filePath={displayFilePath}
          directory={workspaceDirectoryHint}
          fileCountLabel={
            fileList.length > 0
              ? fileList.length === 1
                ? "1 file"
                : `${fileList.length} files`
              : undefined
          }
          countLabel={
            diagnosticCount > 0
              ? tSessions("simulator.replay.ide.codePanel.resultCount", {
                  count: diagnosticCount,
                })
              : tSessions("simulator.replay.ide.codePanel.lspNoDiagnostics")
          }
        />
        {checkedFilesOnly && fileList.length > 0 ? (
          <div className="flex w-full min-w-0 flex-col gap-0.5 p-2">
            {fileList.map((file, idx) => (
              <ExploreResultRow
                key={`${file}-${idx}`}
                filePath={file}
                workspaceDirectoryHint={workspaceDirectoryHint}
              />
            ))}
          </div>
        ) : results.length > 0 ? (
          <div className="flex w-full min-w-0 flex-col p-1">
            {(() => {
              const perFileDiagnostics = new Map<string, SearchResult[]>();
              const orderedFiles: string[] = [];
              for (const result of results) {
                if (!perFileDiagnostics.has(result.file)) {
                  orderedFiles.push(result.file);
                  perFileDiagnostics.set(result.file, []);
                }
                perFileDiagnostics.get(result.file)!.push(result);
              }
              return orderedFiles.map((file, idx) => {
                const fileDiagnostics = perFileDiagnostics.get(file) ?? [];
                return (
                  <div
                    key={`${file}-${idx}`}
                    className="flex w-full min-w-0 flex-col"
                  >
                    <ExploreResultRow
                      filePath={file}
                      workspaceDirectoryHint={workspaceDirectoryHint}
                      count={fileDiagnostics.length}
                    />
                    <div className="flex w-full min-w-0 flex-col pl-6">
                      {fileDiagnostics.map((diagnostic, diagIdx) => {
                        const parsed = parseDiagnosticContent(
                          diagnostic.content
                        );
                        return (
                          <DiagnosticRow
                            key={`${file}-${diagnostic.line}-${diagIdx}`}
                            severity={parsed.severity}
                            message={parsed.message}
                            source={parsed.source}
                            line={diagnostic.line}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        ) : null}
      </div>
    );
  }

  if (exploreType === "code_search") {
    const displayResults: SearchResult[] = results;

    const perFileCounts = new Map<string, number>();
    for (const result of displayResults) {
      perFileCounts.set(result.file, (perFileCounts.get(result.file) ?? 0) + 1);
    }
    const visibleResultCount = displayResults.reduce((sum, result) => {
      const snippet = searchSnippetOneLine(result.content);
      return sum + (parseMatchCountText(snippet) ?? 1);
    }, 0);
    const countLabel = tSessions("simulator.replay.ide.codePanel.resultCount", {
      count: visibleResultCount,
    });

    return (
      <div className="flex w-full min-w-0 flex-col">
        <SearchSummaryHeader
          query={_query}
          directory={workspaceDirectoryHint}
          toolLabel={getToolDisplayLabelFromRegistry(
            "code_search",
            exploreAction === "grep" ? "grep" : undefined
          )}
          countLabel={countLabel}
        />
        <div className="flex w-full min-w-0 flex-col p-1">
          {displayResults.map((result: SearchResult, idx: number) => {
            const snippet = searchSnippetOneLine(result.content);
            const explicitGrepCount = parseMatchCountText(snippet);
            const derivedCount = perFileCounts.get(result.file) ?? 0;
            const rowCount = explicitGrepCount ?? derivedCount;
            const hideSnippetForCount = typeof explicitGrepCount === "number";
            const lineLabel =
              result.line > 0
                ? tSessions(
                    "simulator.replay.ide.codePanel.searchResultLinePrefix",
                    { line: result.line }
                  )
                : undefined;
            return (
              <ExploreResultRow
                key={`${result.file}-${result.line}-${idx}`}
                filePath={result.file}
                workspaceDirectoryHint={workspaceDirectoryHint}
                detail={hideSnippetForCount ? undefined : snippet}
                count={rowCount}
                lineLabel={lineLabel}
              />
            );
          })}
        </div>
      </div>
    );
  }

  // No results found (operation completed but returned empty)
  return (
    <Placeholder
      variant="empty"
      placement="detail-panel"
      fillParentHeight
      title={tSessions("tools.noResultsFound")}
    />
  );
});

SearchResultsContent.displayName = "SearchResultsContent";
