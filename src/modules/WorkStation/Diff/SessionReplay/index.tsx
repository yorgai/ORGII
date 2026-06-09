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
import {
  FileCode2,
  FilePlus,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
} from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getGitCommits } from "@src/api/http/git";
import type { GitCommitInfo } from "@src/api/http/git/types";
import TabPill from "@src/components/TabPill";
import { SIMULATOR_PRIMARY_SIDEBAR } from "@src/config/simulatorPrimarySidebar";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { simulatorEventsAtom } from "@src/engines/SessionCore/derived/simulatorEvents";
import type { SimulatorAppProps } from "@src/engines/Simulator/apps/core/types";
import { createLogger } from "@src/hooks/logger";
import { usePublishWorkstationTabHeader } from "@src/hooks/workStation";
import {
  type DiffFileNavigationItem,
  DiffFileNavigationList,
  type DiffFileSectionData,
  DiffSectionList,
  NoTabsPlaceholder,
  SimulatorReplayChrome,
  WorkStationShell,
  buildConsolidatedSessionReplayDiffSectionItems,
  buildPrimarySidebarConfig,
  buildSessionReplayDiffSectionItems,
  useSimulatorAwaitingAgentCaption,
  useSimulatorPlaceholderActions,
} from "@src/modules/WorkStation/shared";
import {
  PrimarySidebarLayoutWithSections,
  type PrimarySidebarTab,
} from "@src/modules/WorkStation/shared/PrimarySidebarLayout";
import type { ReplayTab } from "@src/modules/WorkStation/shared/SessionReplay/ReplayTabBar";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { getGitArtifactsFromEvent } from "@src/shared/git/sessionGitArtifacts";
import { sessionByIdAtom } from "@src/store/session";
import {
  simulatorPrimarySidebarCollapsedAtom,
  simulatorPrimarySidebarPositionAtom,
  simulatorPrimarySidebarWidthAtom,
  simulatorPrimarySidebarWidthPersistAtom,
} from "@src/store/ui/simulatorAtom";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";

import {
  type SubmissionArtifact,
  type SubmissionCommit,
  SubmissionCommitsContent,
  SubmissionPullRequestsContent,
  deriveSubmissionsData,
} from "./SubmissionsContent";
import { isCodeFilePath } from "./config";
import type { DiffFilter } from "./types";
import { useDiff } from "./useDiff";

type DiffPillMode = "focus" | "all-changes";

const SUBMISSION_COMMIT_RESOLVE_LIMIT = 200;
const logger = createLogger("SessionReplayDiff");

const GitCommitDetailContent = React.lazy(
  () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/GitCommitDetailContent")
);

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

interface SubmissionRepoContext {
  repoId?: string;
  repoPath?: string;
}

function hasRepoContext(context: SubmissionRepoContext | null): boolean {
  return Boolean(context?.repoId || context?.repoPath);
}

function getSessionIdFromUnknown(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return typeof record.sessionId === "string" ? record.sessionId : null;
}

function getRepoContextFromUnknown(value: unknown): SubmissionRepoContext {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const repoId =
    typeof record.repoId === "string"
      ? record.repoId
      : typeof record.repo_id === "string"
        ? record.repo_id
        : undefined;
  const repoPath =
    typeof record.repoPath === "string"
      ? record.repoPath
      : typeof record.repo_path === "string"
        ? record.repo_path
        : undefined;
  return { repoId: repoId ?? repoPath, repoPath };
}

function resolveLatestRepoContext(
  events: readonly SessionEvent[],
  fallbackRepoContext: SubmissionRepoContext
): SubmissionRepoContext {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.repoId || event.repoPath) {
      return {
        repoId: event.repoId ?? event.repoPath,
        repoPath: event.repoPath,
      };
    }
  }
  return fallbackRepoContext;
}

function getRepoContextKey(context: SubmissionRepoContext): string | null {
  const repoId = context.repoId ?? context.repoPath;
  if (!repoId) return null;
  return `${repoId}:${context.repoPath ?? ""}`;
}

function commitMatchesSubmission(
  candidate: GitCommitInfo,
  submission: SubmissionCommit
): boolean {
  const sha = submission.sha.toLowerCase();
  return (
    candidate.sha.toLowerCase().startsWith(sha) ||
    candidate.short_sha.toLowerCase() === sha
  );
}

function mergeResolvedCommit(
  submission: SubmissionCommit,
  resolved: GitCommitInfo | undefined,
  context: SubmissionRepoContext
): SubmissionCommit {
  if (!resolved) {
    return {
      ...submission,
      repoId: submission.repoId ?? context.repoId,
      repoPath: submission.repoPath ?? context.repoPath,
    };
  }

  return {
    ...submission,
    sha: resolved.sha,
    short_sha: resolved.short_sha,
    summary: resolved.summary,
    author: resolved.author,
    repoId: submission.repoId ?? context.repoId,
    repoPath: submission.repoPath ?? context.repoPath,
  };
}

function collectSubmissionArtifacts(
  events: readonly SessionEvent[],
  fallbackRepoContext: SubmissionRepoContext
): SubmissionArtifact[] {
  const artifacts: SubmissionArtifact[] = [];
  const lockedRepoContext = hasRepoContext(fallbackRepoContext)
    ? fallbackRepoContext
    : null;
  let nearestRepoContext: SubmissionRepoContext | null = lockedRepoContext;

  for (const event of events) {
    if (!lockedRepoContext && (event.repoId || event.repoPath)) {
      nearestRepoContext = {
        repoId: event.repoId ?? event.repoPath,
        repoPath: event.repoPath,
      };
    }

    const artifactRepoContext = lockedRepoContext ?? nearestRepoContext;
    artifacts.push(
      ...getGitArtifactsFromEvent(event).map((artifact) => ({
        ...artifact,
        repoId: artifactRepoContext?.repoId,
        repoPath: artifactRepoContext?.repoPath,
      }))
    );
  }
  return artifacts;
}

function filterSectionsByType<T extends { file: { path: string } }>(
  sections: T[],
  filter: DiffFilter
): T[] {
  if (filter === "all") return sections;
  return sections.filter((section) => {
    const isCode = isCodeFilePath(section.file.path);
    return filter === "code" ? isCode : !isCode;
  });
}

const SessionReplayDiff: React.FC<SimulatorAppProps> = ({
  currentEvent,
  mode = "simulation",
}) => {
  const { t } = useTranslation("sessions");
  const { t: tCommon } = useTranslation("common");
  const [filter, setFilter] = useState<DiffFilter>("all");
  const [pillMode, setPillMode] = useState<DiffPillMode>("all-changes");
  const [historySelection, setHistorySelection] =
    useState<SourceControlHistorySelection | null>(null);
  const [historyRepoContext, setHistoryRepoContext] = useState<{
    repoId?: string;
    repoPath?: string;
  } | null>(null);
  const [focusedDiffPath, setFocusedDiffPath] = useState<string | null>(null);
  const [focusedDiffNonce, setFocusedDiffNonce] = useState(0);
  const simulatorEvents = useAtomValue(simulatorEventsAtom);
  const sessionId = useMemo(
    () =>
      getSessionIdFromUnknown(currentEvent) ?? simulatorEvents[0]?.sessionId,
    [currentEvent, simulatorEvents]
  );
  const session = useAtomValue(sessionByIdAtom(sessionId ?? ""));
  const sessionRepoPath = session?.repoPath ?? "";
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

  const fallbackRepoContext = useMemo(() => {
    const sessionRepoContext = sessionRepoPath
      ? { repoId: sessionRepoPath, repoPath: sessionRepoPath }
      : {};
    if (hasRepoContext(sessionRepoContext)) return sessionRepoContext;
    const currentEventRepoContext = getRepoContextFromUnknown(currentEvent);
    if (hasRepoContext(currentEventRepoContext)) return currentEventRepoContext;
    return resolveLatestRepoContext(simulatorEvents, {});
  }, [currentEvent, sessionRepoPath, simulatorEvents]);
  const submissionsData = useMemo(
    () =>
      deriveSubmissionsData(
        collectSubmissionArtifacts(simulatorEvents, fallbackRepoContext)
      ),
    [fallbackRepoContext, simulatorEvents]
  );

  useEffect(() => {
    logger.info("submission artifacts derived", {
      eventCount: simulatorEvents.length,
      commitCount: submissionsData.commits.length,
      pullRequestCount: submissionsData.pullRequests.length,
      fallbackRepoContext,
      currentRepoContext: getRepoContextFromUnknown(currentEvent),
      sessionId,
      sessionRepoPath,
    });
  }, [
    currentEvent,
    fallbackRepoContext,
    sessionId,
    sessionRepoPath,
    simulatorEvents.length,
    submissionsData.commits.length,
    submissionsData.pullRequests.length,
  ]);

  const [resolvedSubmissionCommits, setResolvedSubmissionCommits] = useState<
    SubmissionCommit[]
  >([]);

  useEffect(() => {
    let cancelled = false;

    async function resolveSubmissionsAgainstGitHistory() {
      logger.info("resolving submission commits against git history", {
        submissionCount: submissionsData.commits.length,
        fallbackRepoContext,
      });

      const resolvedByContextKey = new Map<string, GitCommitInfo[]>();
      const nextCommits = await Promise.all(
        submissionsData.commits.map(async (submission) => {
          const context = {
            repoId: submission.repoId ?? fallbackRepoContext.repoId,
            repoPath: submission.repoPath ?? fallbackRepoContext.repoPath,
          };
          const contextKey = getRepoContextKey(context);
          logger.info("submission commit resolve candidate", {
            parsedSha: submission.sha,
            parsedShortSha: submission.short_sha,
            parsedSummary: submission.summary,
            context,
            contextKey,
            hasFullSha: submission.sha.length >= 40,
          });

          if (!contextKey) {
            logger.warn("submission commit missing repo context", {
              parsedSha: submission.sha,
              parsedSummary: submission.summary,
              fallbackRepoContext,
            });
            return mergeResolvedCommit(submission, undefined, context);
          }

          if (submission.sha.length >= 40) {
            logger.info("submission commit already has full sha", {
              commitSha: submission.sha,
              context,
            });
            return mergeResolvedCommit(submission, undefined, context);
          }

          let commits = resolvedByContextKey.get(contextKey);
          if (!commits) {
            logger.info(
              `loading git history for submission commit resolve sha=${submission.sha} repoId=${context.repoId ?? context.repoPath ?? ""} repoPath=${context.repoPath ?? ""}`,
              {
                repoId: context.repoId ?? context.repoPath ?? "",
                repoPath: context.repoPath,
                limit: SUBMISSION_COMMIT_RESOLVE_LIMIT,
              }
            );
            const result = await getGitCommits({
              repo_id: context.repoId ?? context.repoPath ?? "",
              repo_path: context.repoPath,
              limit: SUBMISSION_COMMIT_RESOLVE_LIMIT,
            });
            commits = result?.commits ?? [];
            resolvedByContextKey.set(contextKey, commits);
            logger.info("git history loaded for submission commit resolve", {
              repoId: context.repoId ?? context.repoPath ?? "",
              repoPath: context.repoPath,
              loadedCommitCount: commits.length,
              firstCommitSha: commits[0]?.sha,
              firstCommitSummary: commits[0]?.summary,
            });
          }

          const resolvedCommit = commits.find((candidate) =>
            commitMatchesSubmission(candidate, submission)
          );
          if (!resolvedCommit) {
            logger.warn("submission commit did not match git history", {
              parsedSha: submission.sha,
              parsedSummary: submission.summary,
              context,
              loadedCommitCount: commits.length,
            });
          } else {
            logger.info("submission commit matched git history", {
              parsedSha: submission.sha,
              resolvedSha: resolvedCommit.sha,
              resolvedShortSha: resolvedCommit.short_sha,
              resolvedSummary: resolvedCommit.summary,
              context,
            });
          }

          return mergeResolvedCommit(submission, resolvedCommit, context);
        })
      );

      if (!cancelled) {
        logger.info("submission commits resolved", {
          resolvedCount: nextCommits.length,
          commits: nextCommits.map((commit) => ({
            sha: commit.sha,
            shortSha: commit.short_sha,
            summary: commit.summary,
            repoId: commit.repoId,
            repoPath: commit.repoPath,
          })),
        });
        setResolvedSubmissionCommits(nextCommits);
      }
    }

    void resolveSubmissionsAgainstGitHistory();

    return () => {
      cancelled = true;
    };
  }, [fallbackRepoContext, submissionsData.commits]);

  const submissionCommits =
    resolvedSubmissionCommits.length > 0
      ? resolvedSubmissionCommits
      : submissionsData.commits;
  const hasSubmissions =
    submissionCommits.length > 0 || submissionsData.pullRequests.length > 0;

  usePublishWorkstationTabHeader({
    host: "simulator",
    content: diffHeaderContent,
    enabled: counts.all > 0 || hasSubmissions,
  });

  const sidebarItems = useMemo(
    () =>
      filterSectionsByType(
        buildConsolidatedSessionReplayDiffSectionItems(filteredEntries),
        filter
      ),
    [filteredEntries, filter]
  );

  const handleSubmissionCommitSelect = useCallback(
    (commit: SubmissionCommit) => {
      logger.info(
        `submission commit selected sha=${commit.sha} repoId=${commit.repoId ?? ""} repoPath=${commit.repoPath ?? ""}`,
        {
          commitSha: commit.sha,
          shortSha: commit.short_sha,
          summary: commit.summary,
          repoId: commit.repoId,
          repoPath: commit.repoPath,
        }
      );
      setHistorySelection({
        type: "commit",
        commitSha: commit.sha,
        shortSha: commit.short_sha,
        commitMessage: commit.summary,
      });
      setHistoryRepoContext({
        repoId: commit.repoId,
        repoPath: commit.repoPath,
      });
    },
    []
  );

  const handleSidebarItemSelect = useCallback(
    (item: DiffFileNavigationItem<DiffFileSectionData>) => {
      setHistorySelection(null);
      setHistoryRepoContext(null);
      if (pillMode === "all-changes") {
        setFocusedDiffPath(item.file.path);
        setFocusedDiffNonce((prev) => prev + 1);
        return;
      }

      const entryIds = item.entryIds ?? [];
      const targetEntryId = entryIds[entryIds.length - 1];
      if (targetEntryId) selectEntry(targetEntryId);
    },
    [pillMode, selectEntry]
  );

  const sidebarTab = useMemo<PrimarySidebarTab>(
    () => ({
      key: "diff-sidebar",
      label: t("simulator.replay.diffApp.tabLabel", "Diff"),
      sections: [
        {
          key: "diff-list",
          title: t("simulator.replay.diffApp.tabLabel", "Diff"),
          content: (
            <DiffFileNavigationList
              items={sidebarItems}
              selectedEntryId={
                historySelection
                  ? null
                  : (selectedEntryId ?? displayEntry?.entryId ?? null)
              }
              onSelectItem={handleSidebarItemSelect}
            />
          ),
          defaultFlexGrow: 1,
          collapsible: true,
          resizable: false,
        },
        {
          key: "submission-commits",
          title: t("simulator.replay.diffApp.submissions.commits", "Commits"),
          icon: <GitCommitHorizontal size={14} className="shrink-0" />,
          content: (
            <SubmissionCommitsContent
              commits={submissionCommits}
              selectedCommitSha={
                historySelection?.type === "commit"
                  ? historySelection.commitSha
                  : null
              }
              onCommitSelect={handleSubmissionCommitSelect}
              emptyLabel={t(
                "simulator.replay.diffApp.submissions.noCommits",
                "No commits yet."
              )}
            />
          ),
          defaultFlexGrow: 0.65,
          collapsible: true,
          resizable: false,
        },
        {
          key: "submission-pull-requests",
          title: t("simulator.replay.diffApp.submissions.pr", "PR"),
          icon: <GitPullRequest size={14} className="shrink-0" />,
          content: (
            <SubmissionPullRequestsContent
              pullRequests={submissionsData.pullRequests}
              emptyLabel={t(
                "simulator.replay.diffApp.submissions.noPullRequests",
                "No pull requests yet."
              )}
            />
          ),
          defaultFlexGrow: 0.55,
          collapsible: true,
          resizable: false,
        },
      ],
    }),
    [
      sidebarItems,
      historySelection,
      selectedEntryId,
      displayEntry,
      handleSidebarItemSelect,
      submissionCommits,
      submissionsData,
      handleSubmissionCommitSelect,
      t,
    ]
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

  const consolidatedSections = useMemo(
    () => buildConsolidatedSessionReplayDiffSectionItems(filteredEntries),
    [filteredEntries]
  );

  const focusedSections = useMemo(
    () =>
      displayEntry ? buildSessionReplayDiffSectionItems(displayEntry) : [],
    [displayEntry]
  );

  useEffect(() => {
    if (historySelection?.type !== "commit") return;
    const detailRepoPath =
      historyRepoContext?.repoPath ?? fallbackRepoContext.repoPath;
    const detailRepoId =
      historyRepoContext?.repoId ??
      fallbackRepoContext.repoId ??
      detailRepoPath;
    logger.info(
      `commit detail context resolved sha=${historySelection.commitSha} repoId=${detailRepoId ?? ""} repoPath=${detailRepoPath ?? ""} ready=${Boolean(detailRepoPath && detailRepoId)}`,
      {
        commitSha: historySelection.commitSha,
        shortSha: historySelection.shortSha,
        commitMessage: historySelection.commitMessage,
        detailRepoId,
        detailRepoPath,
        repoReady: Boolean(detailRepoPath && detailRepoId),
        historyRepoContext,
        fallbackRepoContext,
      }
    );
  }, [historySelection, historyRepoContext, fallbackRepoContext]);

  const detailContent = useMemo(() => {
    if (historySelection?.type === "commit") {
      const detailRepoPath =
        historyRepoContext?.repoPath ?? fallbackRepoContext.repoPath;
      const detailRepoId =
        historyRepoContext?.repoId ??
        fallbackRepoContext.repoId ??
        detailRepoPath;
      const repoReady = Boolean(detailRepoPath && detailRepoId);
      if (!repoReady) {
        return (
          <Placeholder
            variant="empty"
            placement="detail-panel"
            title={historySelection.commitMessage}
            subtitle={historySelection.shortSha}
            fillParentHeight
          />
        );
      }

      return (
        <React.Suspense
          fallback={
            <Placeholder
              variant="loading"
              placement="detail-panel"
              title={tCommon("actions.loading")}
              fillParentHeight
            />
          }
        >
          <GitCommitDetailContent
            repoId={detailRepoId ?? ""}
            repoPath={detailRepoPath ?? ""}
            commitSha={historySelection.commitSha}
            shortSha={historySelection.shortSha}
            commitMessage={historySelection.commitMessage}
            isRepoReady={repoReady}
            publishHeaderToWorkstation={false}
          />
        </React.Suspense>
      );
    }

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
        <DiffSectionList
          sections={consolidatedSections}
          emptyTitle={t(
            "simulator.replay.diffApp.emptyForFilter",
            "No diffs match this filter yet."
          )}
          focusedPath={focusedDiffPath}
          focusedNonce={focusedDiffNonce}
        />
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
      <DiffSectionList
        sections={focusedSections}
        emptyTitle={t(
          "simulator.replay.diffApp.emptyDetail",
          "Select a change to view the diff."
        )}
        collapseThreshold={Number.POSITIVE_INFINITY}
        showBottomBorder={false}
      />
    );
  }, [
    historySelection,
    historyRepoContext,
    fallbackRepoContext,
    tCommon,
    pillMode,
    filteredEntries,
    consolidatedSections,
    displayEntry,
    focusedSections,
    focusedDiffPath,
    focusedDiffNonce,
    t,
  ]);

  if (counts.all === 0 && !hasSubmissions) {
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
