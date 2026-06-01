/**
 * WorkspacesView — Per-workspace coding activity breakdown.
 *
 * Aggregates DailySummary data by workspace path to show coding time,
 * lines changed, file edits, and top language for each workspace.
 */
import { AppWindow, Code, TerminalSquare } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getDevRecordSummary } from "@src/api/tauri/devRecord";
import type { DailySummary } from "@src/api/tauri/devRecord/types";
import FileTypeIcon from "@src/components/FileTypeIcon";
import type { FileType } from "@src/components/FileTypeIcon";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
} from "@src/components/SettingsTable";
import SoftwareIcon from "@src/components/SoftwareIcon";
import {
  COLLAPSIBLE_SECTION_TOKENS,
  CollapsibleSection,
  DETAIL_PANEL_TOKENS,
  InternalHeader,
  PanelRefreshButton,
  Placeholder,
  STAT_GRID_TOKENS,
  ScrollFadeContainer,
} from "@src/modules/shared/layouts/blocks";

import DateRangePill from "../../components/DateRangePill";
import StatCard, { DiffValue } from "../../components/StatCard";
import { STAT_CARD_CONFIG } from "../../statCardConfig";
import {
  DATE_RANGE_OPTIONS,
  DEFAULT_RANGE,
  computeDateRange,
  formatDuration,
  formatSourceLabel,
} from "../CodingProfileView/config";
import type {
  FetchResult,
  ProfileDateRange,
} from "../CodingProfileView/config";
import FileHotspots from "./FileHotspots";

interface WorkspaceRow {
  workspacePath: string;
  totalSeconds: number;
  linesAdded: number;
  linesRemoved: number;
  fileEdits: number;
  filesTouched: number;
  topLanguage: string;
  primarySource: string;
}

/**
 * Builds a mapping from raw workspace paths → repo root path.
 *
 * If path A is a prefix of path B (i.e. B is inside A's directory tree),
 * both map to A. This collapses subfolders like `repo/src-tauri` into `repo`.
 */
function buildWorkspaceRootMap(rawPaths: string[]): Map<string, string> {
  const normalized = rawPaths.map((raw) =>
    raw.replace(/\\/g, "/").replace(/\/+$/, "")
  );
  const unique = Array.from(new Set(normalized)).sort(
    (pathA, pathB) => pathA.length - pathB.length
  );

  const roots: string[] = [];
  const rootMap = new Map<string, string>();

  for (const path of unique) {
    const parent = roots.find(
      (root) => path === root || path.startsWith(root + "/")
    );
    rootMap.set(path, parent ?? path);
    if (!parent) roots.push(path);
  }

  const result = new Map<string, string>();
  for (const raw of rawPaths) {
    const norm = raw.replace(/\\/g, "/").replace(/\/+$/, "");
    result.set(raw, rootMap.get(norm) ?? norm);
  }
  return result;
}

function aggregateByWorkspace(summary: DailySummary[]): WorkspaceRow[] {
  const allPaths = summary
    .map((row) => row.workspacePath)
    .filter((workspacePath): workspacePath is string => workspacePath != null);
  const rootMap = buildWorkspaceRootMap(allPaths);

  const byWorkspace = new Map<
    string,
    {
      totalSeconds: number;
      linesAdded: number;
      linesRemoved: number;
      fileEdits: number;
      filesTouched: number;
      languages: Map<string, number>;
      sources: Map<string, number>;
    }
  >();

  for (const row of summary) {
    const workspaceKey =
      row.workspacePath != null
        ? (rootMap.get(row.workspacePath) ?? row.workspacePath)
        : "Unknown";
    const existing = byWorkspace.get(workspaceKey);

    if (existing) {
      existing.totalSeconds += row.totalSeconds;
      existing.linesAdded += row.linesAdded;
      existing.linesRemoved += row.linesRemoved;
      existing.fileEdits += row.fileEdits;
      existing.filesTouched += row.filesTouched;
      if (row.language) {
        existing.languages.set(
          row.language,
          (existing.languages.get(row.language) ?? 0) + row.totalSeconds
        );
      }
      existing.sources.set(
        row.primarySource,
        (existing.sources.get(row.primarySource) ?? 0) + row.totalSeconds
      );
    } else {
      const languages = new Map<string, number>();
      if (row.language) languages.set(row.language, row.totalSeconds);
      const sources = new Map<string, number>();
      sources.set(row.primarySource, row.totalSeconds);

      byWorkspace.set(workspaceKey, {
        totalSeconds: row.totalSeconds,
        linesAdded: row.linesAdded,
        linesRemoved: row.linesRemoved,
        fileEdits: row.fileEdits,
        filesTouched: row.filesTouched,
        languages,
        sources,
      });
    }
  }

  return Array.from(byWorkspace.entries())
    .map(([workspacePath, values]) => {
      let topLanguage = "—";
      let maxLangTime = 0;
      for (const [lang, time] of values.languages) {
        if (time > maxLangTime) {
          maxLangTime = time;
          topLanguage = lang;
        }
      }

      let primarySource = "unknown";
      let maxSourceTime = 0;
      for (const [source, time] of values.sources) {
        if (time > maxSourceTime) {
          maxSourceTime = time;
          primarySource = source;
        }
      }

      return {
        workspacePath,
        totalSeconds: values.totalSeconds,
        linesAdded: values.linesAdded,
        linesRemoved: values.linesRemoved,
        fileEdits: values.fileEdits,
        filesTouched: values.filesTouched,
        topLanguage,
        primarySource,
      };
    })
    .sort((rowA, rowB) => rowB.totalSeconds - rowA.totalSeconds);
}

function formatWorkspaceName(workspacePath: string): string {
  const parts = workspacePath.split("/");
  return parts[parts.length - 1] || workspacePath;
}

const LANGUAGE_TO_FILE_TYPE: Record<string, FileType> = {
  Rust: "rust",
  TypeScript: "typescript",
  "TypeScript React": "tsx",
  JavaScript: "javascript",
  "JavaScript React": "jsx",
  Python: "python",
  Go: "go",
  Java: "java",
  Kotlin: "kotlin",
  Swift: "swift",
  C: "c",
  "C++": "cpp",
  "C/C++ Header": "h",
  "C#": "csharp",
  Ruby: "ruby",
  PHP: "php",
  Lua: "lua",
  R: "r",
  Scala: "scala",
  Dart: "dart",
  Zig: "zig",
  Elixir: "elixir",
  Erlang: "erlang",
  Haskell: "haskell",
  OCaml: "ocaml",
  Clojure: "clojure",
  SQL: "sql",
  HTML: "html",
  CSS: "css",
  SCSS: "scss",
  Less: "less",
  JSON: "json",
  YAML: "yaml",
  TOML: "toml",
  XML: "xml",
  Markdown: "markdown",
  Shell: "shell",
  PowerShell: "powershell",
  Dockerfile: "docker",
  Terraform: "terraform",
  Vue: "vue",
  Svelte: "svelte",
  Astro: "astro",
  GraphQL: "graphql",
  "Protocol Buffers": "proto",
};

const SOURCE_ICON_SIZE = 14;

function SourceIconRenderer({
  source,
}: {
  source: string;
}): React.ReactElement {
  if (source === "terminal") {
    return <TerminalSquare size={SOURCE_ICON_SIZE} className="text-text-2" />;
  }
  if (source === "orgii_editor") {
    return <AppWindow size={SOURCE_ICON_SIZE} className="text-text-2" />;
  }
  return (
    <SoftwareIcon type={source} size={SOURCE_ICON_SIZE} className="shrink-0" />
  );
}

const WorkspacesView: React.FC = () => {
  const { t } = useTranslation();
  const [range, setRange] = useState<ProfileDateRange>(DEFAULT_RANGE);
  const [customDates, setCustomDates] = useState<{
    startDate: string;
    endDate: string;
  } | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const dateRange = useMemo(
    () => computeDateRange(range, customDates ?? undefined),
    [range, customDates]
  );
  const fetchKey = `projects:${dateRange.startDate}:${dateRange.endDate}:${retryCount}`;

  const [result, setResult] = useState<FetchResult<DailySummary[]> | null>(
    null
  );
  const validResult = result?.key === fetchKey ? result : null;
  const isLoading = !validResult && !result;

  const handleRetryAction = useCallback(() => {
    setRetryCount((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const effectKey = `projects:${dateRange.startDate}:${dateRange.endDate}:${retryCount}`;
    let cancelled = false;

    getDevRecordSummary(dateRange.startDate, dateRange.endDate)
      .then((data) => {
        if (!cancelled) setResult({ key: effectKey, data, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setResult({
            key: effectKey,
            data: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dateRange.startDate, dateRange.endDate, retryCount]);

  const summaryData = useMemo(
    () => (validResult ?? result)?.data ?? [],
    [validResult, result]
  );
  const workspaceRows = useMemo(
    () => aggregateByWorkspace(summaryData),
    [summaryData]
  );

  const totalCodingTime = useMemo(
    () => workspaceRows.reduce((acc, row) => acc + row.totalSeconds, 0),
    [workspaceRows]
  );
  const totalLinesAdded = useMemo(
    () => workspaceRows.reduce((acc, row) => acc + row.linesAdded, 0),
    [workspaceRows]
  );
  const totalLinesRemoved = useMemo(
    () => workspaceRows.reduce((acc, row) => acc + row.linesRemoved, 0),
    [workspaceRows]
  );

  const handleRangeChange = useCallback((tab: string) => {
    setRange(tab as ProfileDateRange);
  }, []);

  const handleCustomDatesChange = useCallback(
    (startDate: string, endDate: string) => {
      setCustomDates({ startDate, endDate });
    },
    []
  );

  const columns = useMemo<SettingsTableColumn<WorkspaceRow>[]>(
    () => [
      {
        key: "workspace",
        label: t("projects.workspace"),
        width: SETTINGS_TABLE_COL.fill,
        sorter: (rowA, rowB) =>
          rowA.workspacePath.localeCompare(rowB.workspacePath),
        renderCell: (row) => (
          <span
            className="flex min-w-0 items-center gap-1.5"
            title={row.workspacePath}
          >
            <Code size={14} className="shrink-0 text-text-2" />
            <span className={`${SETTINGS_TABLE_CELL.primary} truncate`}>
              {formatWorkspaceName(row.workspacePath)}
            </span>
          </span>
        ),
      },
      {
        key: "time",
        label: t("projects.duration"),
        width: SETTINGS_TABLE_COL.valueMd,
        align: "right",
        sorter: (rowA, rowB) => rowA.totalSeconds - rowB.totalSeconds,
        renderCell: (row) => (
          <span
            className={`${SETTINGS_TABLE_CELL.value} whitespace-nowrap tabular-nums`}
          >
            {formatDuration(row.totalSeconds)}
          </span>
        ),
      },
      {
        key: "language",
        label: t("projects.topLanguage"),
        width: SETTINGS_TABLE_COL.valueSm,
        renderCell: (row) => {
          const fileType = LANGUAGE_TO_FILE_TYPE[row.topLanguage];
          return (
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              {fileType ? (
                <FileTypeIcon
                  fileName=""
                  type={fileType}
                  size="small"
                  className="shrink-0"
                />
              ) : null}
              <span className={SETTINGS_TABLE_CELL.muted}>
                {row.topLanguage}
              </span>
            </span>
          );
        },
      },
      {
        key: "source",
        label: t("devActivity.source"),
        width: SETTINGS_TABLE_COL.valueSm,
        renderCell: (row) => (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="shrink-0">
              <SourceIconRenderer source={row.primarySource} />
            </span>
            <span className={SETTINGS_TABLE_CELL.muted}>
              {formatSourceLabel(row.primarySource)}
            </span>
          </span>
        ),
      },
      {
        key: "edits",
        label: t("devActivity.fileEdits"),
        width: "80px",
        align: "right",
        sorter: (rowA, rowB) => rowA.fileEdits - rowB.fileEdits,
        renderCell: (row) => (
          <span className={`${SETTINGS_TABLE_CELL.value} tabular-nums`}>
            {row.fileEdits.toLocaleString()}
          </span>
        ),
      },
      {
        key: "lines",
        label: t("devActivity.linesChanged"),
        width: SETTINGS_TABLE_COL.valueMd,
        align: "right",
        sorter: (rowA, rowB) =>
          rowA.linesAdded +
          rowA.linesRemoved -
          (rowB.linesAdded + rowB.linesRemoved),
        renderCell: (row) =>
          row.linesAdded > 0 || row.linesRemoved > 0 ? (
            <span className="whitespace-nowrap tabular-nums">
              <span className="text-green-500">
                +{row.linesAdded.toLocaleString()}
              </span>{" "}
              <span className="text-red-400">
                -{row.linesRemoved.toLocaleString()}
              </span>
            </span>
          ) : (
            <span className={SETTINGS_TABLE_CELL.muted}>—</span>
          ),
      },
    ],
    [t]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <InternalHeader
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
        actions={
          <>
            <DateRangePill
              options={DATE_RANGE_OPTIONS}
              activeKey={range}
              onChange={handleRangeChange}
              onCustomDatesChange={handleCustomDatesChange}
              customStartDate={customDates?.startDate}
              customEndDate={customDates?.endDate}
            />
            <div className={COLLAPSIBLE_SECTION_TOKENS.separator} />
            <PanelRefreshButton
              onRefresh={handleRetryAction}
              loading={isLoading}
              title={t("common:actions.refresh")}
            />
          </>
        }
      />

      <ScrollFadeContainer className={DETAIL_PANEL_TOKENS.scrollContent}>
        {validResult?.error && (
          <Placeholder
            variant="error"
            placement="detail-panel"
            title={validResult.error}
            onRetry={handleRetryAction}
          />
        )}

        {isLoading ? (
          <Placeholder variant="loading" placement="detail-panel" />
        ) : workspaceRows.length === 0 ? (
          <Placeholder
            variant="empty"
            placement="detail-panel"
            title={t("projects.noData")}
          />
        ) : (
          <>
            <div
              className={`${DETAIL_PANEL_TOKENS.sectionGap} ${STAT_GRID_TOKENS.cols3}`}
            >
              <StatCard
                icon={STAT_CARD_CONFIG.projects.icon}
                label={t(STAT_CARD_CONFIG.projects.labelKey)}
              >
                {workspaceRows.length}
              </StatCard>
              <StatCard
                icon={STAT_CARD_CONFIG.codingTime.icon}
                label={t(STAT_CARD_CONFIG.codingTime.labelKey)}
              >
                {formatDuration(totalCodingTime)}
              </StatCard>
              <StatCard
                icon={STAT_CARD_CONFIG.linesChanged.icon}
                label={t(STAT_CARD_CONFIG.linesChanged.labelKey)}
              >
                <DiffValue
                  added={totalLinesAdded}
                  removed={totalLinesRemoved}
                />
              </StatCard>
            </div>

            <CollapsibleSection title={t("projects.title")}>
              <SettingsTable<WorkspaceRow>
                columns={columns}
                rows={workspaceRows}
                getRowKey={(row) => row.workspacePath}
                headerHeight="tall"
                pageSize={50}
                className=""
              />
            </CollapsibleSection>

            <FileHotspots
              startDate={dateRange.startDate}
              endDate={dateRange.endDate}
              refreshKey={retryCount}
            />
          </>
        )}
      </ScrollFadeContainer>
    </div>
  );
};

export default memo(WorkspacesView);
