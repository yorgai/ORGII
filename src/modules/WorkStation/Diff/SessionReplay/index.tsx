/**
 * SessionReplayDiff
 *
 * Dedicated simulator app for reviewing every diff (edit_file,
 * apply_patch, create, overwrite, delete) emitted by the agent.
 *
 * Layout uses the same `WorkStationShell` + simulator primary sidebar atoms
 * as CodeEditor / Browser session replays, so collapse / position (left ↔
 * right) / resize all share the same chrome and persisted state.
 *
 * Filter chrome lives in the shared `SimulatorReplayChrome` as three
 * `ReplayTab`s — All changes / Code / Other deliverables. The trailing
 * Focus / All Changes pill reuses the Source Control `TabPill` component
 * and `common:sourceControl.pill.*` i18n keys.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { FileCode2, FilePlus, GitBranch } from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import TabPill from "@src/components/TabPill";
import { SIMULATOR_PRIMARY_SIDEBAR } from "@src/config/simulatorPrimarySidebar";
import {
  extractEditData,
  parseUnifiedDiffToOldNew,
} from "@src/engines/SessionCore/rendering/props/propsDataExtractors";
import { normalizeEventProps } from "@src/engines/SessionCore/rendering/props/propsNormalizer";
import type { SimulatorAppProps } from "@src/engines/Simulator/apps/core/types";
import { usePublishWorkstationTabHeader } from "@src/hooks/workStation";
import {
  DiffFileSection,
  type DiffFileSectionData,
  NoTabsPlaceholder,
  SimulatorReplayChrome,
  WorkStationShell,
  buildPrimarySidebarConfig,
  useSimulatorAwaitingAgentCaption,
  useSimulatorPlaceholderActions,
} from "@src/modules/WorkStation/shared";
import {
  PrimarySidebarLayoutWithSections,
  type PrimarySidebarTab,
} from "@src/modules/WorkStation/shared/PrimarySidebarLayout";
import type { ReplayTab } from "@src/modules/WorkStation/shared/SessionReplay/ReplayTabBar";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import {
  simulatorPrimarySidebarCollapsedAtom,
  simulatorPrimarySidebarPositionAtom,
  simulatorPrimarySidebarWidthAtom,
  simulatorPrimarySidebarWidthPersistAtom,
} from "@src/store/ui/simulatorAtom";

import DiffSidebarList from "./DiffSidebarList";
import type { DiffEntry, DiffFilter } from "./types";
import { useDiff } from "./useDiff";

type DiffPillMode = "focus" | "all-changes";

interface DiffSectionItem {
  key: string;
  file: DiffFileSectionData;
}

function getDiffStatus(
  entry: DiffEntry,
  isDeleted: boolean | undefined,
  oldContent: string | undefined,
  newContent: string | undefined
): DiffFileSectionData["status"] {
  const action =
    typeof entry.event.args?.action === "string" ? entry.event.args.action : "";
  const functionName = entry.event.functionName || "";
  if (
    isDeleted ||
    action.includes("delete") ||
    functionName.includes("delete")
  ) {
    return "deleted";
  }
  if (action.includes("create") || (!oldContent && Boolean(newContent))) {
    return "added";
  }
  return "modified";
}

function buildDiffSectionItems(entry: DiffEntry): DiffSectionItem[] {
  const universal = normalizeEventProps({ event: entry.event }, "tool_call");
  if (!universal) return [];

  const editData = extractEditData(universal);
  const segments =
    editData.applyPatchSegments && editData.applyPatchSegments.length > 0
      ? editData.applyPatchSegments
      : [editData];

  return segments.map((segment, index) => {
    const parsed =
      segment.diff &&
      (segment.oldContent === undefined || segment.newContent === undefined)
        ? parseUnifiedDiffToOldNew(segment.diff)
        : undefined;
    const isDeleted = segment.isDeleted;
    const oldContent = isDeleted
      ? (segment.oldContent ?? parsed?.oldValue ?? segment.content ?? "")
      : (segment.oldContent ?? parsed?.oldValue ?? "");
    const newContent = isDeleted
      ? ""
      : (segment.newContent ?? parsed?.newValue ?? segment.content ?? "");
    const path = segment.filePath || entry.filePath || entry.fileName;

    return {
      key: `${entry.entryId}:${index}:${path}`,
      file: {
        path,
        status: getDiffStatus(entry, isDeleted, oldContent, newContent),
        staged: false,
        additions: segment.linesAdded,
        deletions: segment.linesRemoved,
        oldContent,
        newContent,
      },
    };
  });
}

const TAB_IDS: Record<DiffFilter, string> = {
  all: "diff-filter:all",
  code: "diff-filter:code",
  other: "diff-filter:other",
};

const FILTER_BY_TAB_ID: Record<string, DiffFilter> = {
  [TAB_IDS.all]: "all",
  [TAB_IDS.code]: "code",
  [TAB_IDS.other]: "other",
};

const SessionReplayDiff: React.FC<SimulatorAppProps> = ({
  mode = "simulation",
}) => {
  const { t } = useTranslation("sessions");
  const { t: tCommon } = useTranslation("common");
  const [filter, setFilter] = useState<DiffFilter>("all");
  const [pillMode, setPillMode] = useState<DiffPillMode>("all-changes");
  const {
    filteredEntries,
    counts,
    displayEntry,
    selectedEntryId,
    selectEntry,
  } = useDiff({ filter });

  const primarySidebarCollapsed = useAtomValue(
    simulatorPrimarySidebarCollapsedAtom
  );
  const primarySidebarPosition = useAtomValue(
    simulatorPrimarySidebarPositionAtom
  );
  const primarySidebarWidth = useAtomValue(simulatorPrimarySidebarWidthAtom);
  const setPrimarySidebarWidthPersist = useSetAtom(
    simulatorPrimarySidebarWidthPersistAtom
  );
  const handlePrimarySidebarWidthChange = useCallback(
    (width: number) => {
      setPrimarySidebarWidthPersist(width);
    },
    [setPrimarySidebarWidthPersist]
  );

  const simulatorPlaceholderActions = useSimulatorPlaceholderActions(mode);
  const simulatorAwaitingAgentCaption = useSimulatorAwaitingAgentCaption();

  const tabs = useMemo<ReplayTab[]>(() => {
    const formatLabel = (base: string, count: number) =>
      count > 0 ? `${base} (${count})` : base;
    return [
      {
        eventId: TAB_IDS.all,
        kind: "diff-filter",
        label: formatLabel(t("simulator.replay.diffApp.filterAll"), counts.all),
        title: t("simulator.replay.diffApp.filterAll"),
        icon: <GitBranch size={14} className="shrink-0" />,
      },
      {
        eventId: TAB_IDS.code,
        kind: "diff-filter",
        label: formatLabel(
          t("simulator.replay.diffApp.filterCode"),
          counts.code
        ),
        title: t("simulator.replay.diffApp.filterCode"),
        icon: <FileCode2 size={14} className="shrink-0" />,
      },
      {
        eventId: TAB_IDS.other,
        kind: "diff-filter",
        label: formatLabel(
          t("simulator.replay.diffApp.filterOther"),
          counts.other
        ),
        title: t("simulator.replay.diffApp.filterOther"),
        icon: <FilePlus size={14} className="shrink-0" />,
      },
    ];
  }, [counts.all, counts.code, counts.other, t]);

  const handleTabClick = useCallback((eventId: string) => {
    const next = FILTER_BY_TAB_ID[eventId];
    if (next) setFilter(next);
  }, []);

  const handlePillModeChange = useCallback((key: string) => {
    if (key === "focus" || key === "all-changes") setPillMode(key);
  }, []);

  const diffHeaderContent = useMemo(
    () => (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className="pointer-events-none mx-1.5 h-4 w-px shrink-0 bg-border-2"
          aria-hidden
        />
        <TabPill
          activeTab={pillMode}
          tabs={[
            { key: "focus", label: tCommon("sourceControl.pill.focus") },
            {
              key: "all-changes",
              label: tCommon("sourceControl.pill.allChanges"),
            },
          ]}
          onChange={handlePillModeChange}
          variant="pill"
          color="fill"
          fillWidth={false}
          size="small"
        />
      </div>
    ),
    [pillMode, handlePillModeChange, tCommon]
  );

  usePublishWorkstationTabHeader({
    host: "simulator",
    content: diffHeaderContent,
    enabled: counts.all > 0,
  });

  const sidebarTab = useMemo<PrimarySidebarTab>(
    () => ({
      key: "diff-sidebar",
      label: t("simulator.replay.diffApp.tabLabel"),
      sections: [
        {
          key: "diff-list",
          title: t("simulator.replay.diffApp.tabLabel"),
          content: (
            <DiffSidebarList
              entries={filteredEntries}
              selectedEntryId={selectedEntryId ?? displayEntry?.entryId ?? null}
              onSelectEntry={selectEntry}
            />
          ),
          defaultFlexGrow: 1,
          collapsible: true,
          resizable: false,
        },
      ],
    }),
    [filteredEntries, selectedEntryId, displayEntry, selectEntry, t]
  );

  const noopTabChange = useCallback(() => {
    // single-tab shell — no-op
  }, []);

  const primarySidebarConfig = useMemo(
    () =>
      buildPrimarySidebarConfig({
        content: (
          <PrimarySidebarLayoutWithSections
            tabs={[sidebarTab]}
            activeTab={sidebarTab.key}
            onTabChange={noopTabChange}
            hideTabs
          />
        ),
        collapsed: primarySidebarCollapsed,
        size: primarySidebarWidth,
        onSizeChange: handlePrimarySidebarWidthChange,
        minSize: SIMULATOR_PRIMARY_SIDEBAR.minWidth,
        maxSize: SIMULATOR_PRIMARY_SIDEBAR.maxWidth,
        resetSize: SIMULATOR_PRIMARY_SIDEBAR.defaultWidth,
      }),
    [
      sidebarTab,
      noopTabChange,
      primarySidebarCollapsed,
      primarySidebarWidth,
      handlePrimarySidebarWidthChange,
    ]
  );

  const renderDiffSections = useCallback((entry: DiffEntry) => {
    const sections = buildDiffSectionItems(entry);
    return sections.map((section) => (
      <DiffFileSection key={section.key} file={section.file} />
    ));
  }, []);

  const detailContent = useMemo(() => {
    if (pillMode === "all-changes") {
      if (filteredEntries.length === 0) {
        return (
          <Placeholder
            variant="empty"
            placement="detail-panel"
            title={t(
              "simulator.replay.diffApp.emptyForFilter",
              "No diffs match this filter yet."
            )}
            fillParentHeight
          />
        );
      }
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-auto">
            {filteredEntries.flatMap(renderDiffSections)}
          </div>
        </div>
      );
    }

    if (!displayEntry) {
      return (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t(
            "simulator.replay.diffApp.emptyDetail",
            "Select a change to view the diff."
          )}
          fillParentHeight
        />
      );
    }
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
          {renderDiffSections(displayEntry)}
        </div>
      </div>
    );
  }, [pillMode, filteredEntries, displayEntry, renderDiffSections, t]);

  if (counts.all === 0) {
    return (
      <SimulatorReplayChrome
        tabs={tabs}
        activeEventId={TAB_IDS[filter]}
        onTabClick={handleTabClick}
      >
        <div className="min-h-0 flex-1">
          <NoTabsPlaceholder
            icon="editor"
            caption={simulatorAwaitingAgentCaption}
            actions={simulatorPlaceholderActions}
          />
        </div>
      </SimulatorReplayChrome>
    );
  }

  return (
    <SimulatorReplayChrome
      tabs={tabs}
      activeEventId={TAB_IDS[filter]}
      onTabClick={handleTabClick}
    >
      <div className="flex min-h-0 flex-1">
        <WorkStationShell
          primarySidebarConfig={primarySidebarConfig}
          content={
            <div className="flex h-full min-h-0 w-full flex-col">
              {detailContent}
            </div>
          }
          statusBar={null}
          layoutMode={primarySidebarPosition === "right" ? "right" : "left"}
          appClassName="session-replay-diff"
        />
      </div>
    </SimulatorReplayChrome>
  );
};

export { SessionReplayDiff as SimulatorDiff };
export default memo(SessionReplayDiff);
