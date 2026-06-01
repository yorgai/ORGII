/**
 * WorkspaceBreakdown — Per-workspace coding activity table + file hotspots.
 *
 * Receives pre-fetched DailySummary data, aggregates by workspace,
 * and renders a sortable table with language/source icons.
 */
import { AppWindow, Code, TerminalSquare } from "lucide-react";
import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

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
  CollapsibleTableSection,
  Placeholder,
} from "@src/modules/shared/layouts/blocks";

import FileHotspots from "./FileHotspots";
import { formatDuration, formatSourceLabel } from "./config";

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

interface WorkspaceBreakdownProps {
  summary: DailySummary[];
  startDate: string;
  endDate: string;
  refreshKey: number;
}

const WorkspaceBreakdown: React.FC<WorkspaceBreakdownProps> = memo(
  ({ summary, startDate, endDate, refreshKey }) => {
    const { t } = useTranslation();

    const workspaceRows = useMemo(
      () => aggregateByWorkspace(summary),
      [summary]
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

    if (workspaceRows.length === 0) {
      return <Placeholder variant="empty" title={t("projects.noData")} />;
    }

    return (
      <>
        <CollapsibleTableSection noWrapper title={t("projects.title")}>
          <SettingsTable<WorkspaceRow>
            columns={columns}
            rows={workspaceRows}
            getRowKey={(row) => row.workspacePath}
            headerHeight="tall"
            pageSize={50}
            className=""
          />
        </CollapsibleTableSection>

        <FileHotspots
          startDate={startDate}
          endDate={endDate}
          refreshKey={refreshKey}
        />
      </>
    );
  }
);

WorkspaceBreakdown.displayName = "WorkspaceBreakdown";

export default WorkspaceBreakdown;
