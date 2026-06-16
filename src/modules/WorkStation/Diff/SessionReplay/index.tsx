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
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { GitBranch, ListChevronsDownUp, RotateCcw, Send } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getGitCommits } from "@src/api/http/git";
import type { GitCommitInfo } from "@src/api/http/git/types";
import {
  type OrgtrackCommitLink,
  type OrgtrackSessionFinalDiff,
  getOrgtrackSessionCommitLinks,
  getOrgtrackSessionFinalDiffs,
} from "@src/api/tauri/lineage";
import Button from "@src/components/Button";
import TabPill from "@src/components/TabPill";
import { SIMULATOR_PRIMARY_SIDEBAR } from "@src/config/simulatorPrimarySidebar";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { simulatorEventsAtom } from "@src/engines/SessionCore/derived/simulatorEvents";
import {
  parseUnifiedDiffToHunks,
  parseUnifiedDiffToOldNew,
} from "@src/engines/SessionCore/rendering/props/propsDataExtractors";
import type { SimulatorAppProps } from "@src/engines/Simulator/apps/core/types";
import { useFileReviewBatchActions } from "@src/hooks/fileReview/useFileReview";
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
import { reposAtom } from "@src/store/repo/atoms";
import { sessionByIdAtom } from "@src/store/session";
import {
  simulatorDiffCommitNavigationRequestAtom,
  simulatorDiffRefreshNonceAtom,
  simulatorDiffScopeRequestAtom,
  simulatorPrimarySidebarCollapsedAtom,
  simulatorPrimarySidebarPositionAtom,
  simulatorPrimarySidebarWidthAtom,
  simulatorPrimarySidebarWidthPersistAtom,
} from "@src/store/ui/simulatorAtom";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

import {
  type SubmissionArtifact,
  type SubmissionCommit,
  SubmissionCommitsContent,
  SubmissionPullRequestsContent,
  deriveSubmissionsData,
} from "./SubmissionsContent";
import {
  filterDiffSectionsByScope,
  isDiffScopeActive,
  resolveScopedSelectedPath,
} from "./diffScope";
import type { DiffReplayTab } from "./types";
import { useDiff } from "./useDiff";

type DiffPillMode = "focus" | "all-changes";

const SUBMISSION_COMMIT_RESOLVE_LIMIT = 200;
const logger = createLogger("SessionReplayDiff");

function commitLinkToSubmissionCommit(
  link: OrgtrackCommitLink,
  fallbackRepoContext: SubmissionRepoContext
): SubmissionCommit {
  const shortSha = link.commitSha.slice(0, 7);
  return {
    sha: link.commitSha,
    short_sha: shortSha,
    summary: shortSha,
    author: null,
    repoId: fallbackRepoContext.repoId,
    repoPath: fallbackRepoContext.repoPath,
  };
}

/** Exported for unit testing. */
export function finalDiffToSection(
  finalDiff: OrgtrackSessionFinalDiff
): DiffFileNavigationItem<DiffFileSectionData> {
  const isDeleted = Boolean(finalDiff.isDeleted);
  const parsedDiff = finalDiff.diff
    ? parseUnifiedDiffToOldNew(finalDiff.diff)
    : undefined;
  const hunks = finalDiff.diff
    ? parseUnifiedDiffToHunks(finalDiff.diff)
    : undefined;

  const oldContent = finalDiff.oldContent ?? parsedDiff?.oldValue ?? "";
  const newContent = isDeleted
    ? ""
    : (finalDiff.newContent ?? parsedDiff?.newValue ?? "");

  const contentUnavailable =
    !finalDiff.diff && !finalDiff.oldContent && !finalDiff.newContent;

  return {
    key: finalDiff.filePath,
    file: {
      path: finalDiff.filePath,
      status: isDeleted ? "deleted" : "modified",
      staged: false,
      additions: finalDiff.linesAdded,
      deletions: finalDiff.linesRemoved,
      oldContent: contentUnavailable ? undefined : oldContent,
      newContent: contentUnavailable ? undefined : newContent,
      oldStartLine: parsedDiff?.oldStartLine,
      newStartLine: parsedDiff?.newStartLine,
      isUnavailable: contentUnavailable || undefined,
      hunks: isDeleted ? undefined : hunks,
    },
    entryIds: [finalDiff.recordId],
  };
}

const GitCommitDetailContent = React.lazy(
  () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/GitCommitDetailContent")
);

const TAB_IDS: Record<DiffReplayTab, string> = {
  all: "diff-tab:all",
  diff: "diff-tab:diff",
  submissions: "diff-tab:submissions",
};

const TAB_BY_ID: Record<string, DiffReplayTab> = {
  [TAB_IDS.all]: "all",
  [TAB_IDS.diff]: "diff",
  [TAB_IDS.submissions]: "submissions",
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
  // Key by filesystem path when available so the same repo reached via
  // different repoId formats (UUID vs path) shares one history cache entry.
  return context.repoPath ?? context.repoId ?? null;
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
    // The commit was actually found in `context`'s git history, so that
    // context is authoritative — the submission's own repo context may be
    // a wrong session-level fallback (e.g. a non-git working directory).
    repoId: context.repoId ?? submission.repoId,
    repoPath: context.repoPath ?? submission.repoPath,
  };
}

// Non-canonical submission-card extraction. Final AI Blame commit counts come
// from Rust Orgtrack summaries; this only preserves clickable replay references.
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
        eventId: event.id,
      }))
    );
  }
  return artifacts;
}

const SessionReplayDiff: React.FC<SimulatorAppProps> = ({
  currentEvent,
  mode = "simulation",
}) => {
  const isCurrentEventLoading =
    (currentEvent as unknown as SessionEvent)?.displayStatus === "running";
  const { t } = useTranslation("sessions");
  const { t: tCommon } = useTranslation("common");
  const [activeTab, setActiveTab] = useState<DiffReplayTab>("diff");
  const [pillMode, setPillMode] = useState<DiffPillMode>("all-changes");
  const [historySelection, setHistorySelection] =
    useState<SourceControlHistorySelection | null>(null);
  const [historyRepoContext, setHistoryRepoContext] = useState<{
    repoId?: string;
    repoPath?: string;
  } | null>(null);
  const [focusedDiffPath, setFocusedDiffPath] = useState<string | null>(null);
  const [focusedDiffNonce, setFocusedDiffNonce] = useState(0);
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);
  const simulatorEvents = useAtomValue(simulatorEventsAtom);
  const sessionId = useMemo(
    () =>
      getSessionIdFromUnknown(currentEvent) ?? simulatorEvents[0]?.sessionId,
    [currentEvent, simulatorEvents]
  );
  const session = useAtomValue(sessionByIdAtom(sessionId ?? ""));
  const sessionRepoPath = session?.repoPath ?? "";
  const repos = useAtomValue(reposAtom);
  const [diffCommitNavigationRequest, setDiffCommitNavigationRequest] = useAtom(
    simulatorDiffCommitNavigationRequestAtom
  );
  const diffScopeRequest = useAtomValue(simulatorDiffScopeRequestAtom);
  // Bumped on every chat→Diff navigation; forces a fresh read of the canonical
  // final diffs below so a just-edited file isn't shown with a stale diff.
  const diffRefreshNonce = useAtomValue(simulatorDiffRefreshNonceAtom);
  const { entries, displayEntry, selectedEntryId, selectEntry } = useDiff();
  const [orgtrackFinalDiffs, setOrgtrackFinalDiffs] = useState<
    OrgtrackSessionFinalDiff[]
  >([]);
  const [orgtrackFinalDiffsLoading, setOrgtrackFinalDiffsLoading] =
    useState(false);
  const [orgtrackCommitLinks, setOrgtrackCommitLinks] = useState<
    OrgtrackCommitLink[]
  >([]);

  useEffect(() => {
    if (!sessionId) {
      setOrgtrackFinalDiffs([]);
      return;
    }

    let cancelled = false;
    setOrgtrackFinalDiffsLoading(true);
    void getOrgtrackSessionFinalDiffs({ sessionId })
      .then((finalDiffs) => {
        if (!cancelled) {
          setOrgtrackFinalDiffs(finalDiffs);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          logger.warn("failed to load orgtrack final diffs", {
            err,
            sessionId,
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOrgtrackFinalDiffsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setOrgtrackCommitLinks([]);
      return;
    }

    let cancelled = false;
    void getOrgtrackSessionCommitLinks({ sessionId })
      .then((commitLinks) => {
        if (!cancelled) {
          setOrgtrackCommitLinks(commitLinks);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          logger.warn("failed to load orgtrack commit links", {
            error,
            sessionId,
          });
          setOrgtrackCommitLinks([]);
        }
      });

    return () => {
      cancelled = true;
    };
    // `diffRefreshNonce` re-runs this load on each chat→Diff navigation so the
    // canonical final diffs reflect the latest working tree (not a stale cache).
  }, [sessionId, diffRefreshNonce]);

  const canonicalFinalSections = useMemo(
    () => orgtrackFinalDiffs.map(finalDiffToSection),
    [orgtrackFinalDiffs]
  );
  const finalDiffCount = canonicalFinalSections.length;

  const simulatorConsolidatedSections = useMemo(
    () => buildConsolidatedSessionReplayDiffSectionItems(entries),
    [entries]
  );
  const hasSimulatorDiffs = simulatorConsolidatedSections.length > 0;

  // When the chat `TurnFilesFooter` requested a per-round scope (and it
  // targets the session on screen), narrow the file list to that round's
  // files; otherwise this is the whole-session diff exactly as before.
  const baseSections =
    finalDiffCount > 0 ? canonicalFinalSections : simulatorConsolidatedSections;

  const sidebarItems = useMemo(
    () => filterDiffSectionsByScope(baseSections, diffScopeRequest, sessionId),
    [baseSections, diffScopeRequest, sessionId]
  );

  const consolidatedSections = sidebarItems;

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

  const handleTabClick = useCallback((eventId: string) => {
    const next = TAB_BY_ID[eventId];
    if (next) setActiveTab(next);
  }, []);

  const handlePillModeChange = useCallback((key: string) => {
    if (key === "focus" || key === "all-changes") setPillMode(key);
  }, []);

  const handleCollapseAll = useCallback(() => {
    setCollapseAllSignal((prev) => prev + 1);
  }, []);

  const { pendingCount, onUndoAll } = useFileReviewBatchActions(sessionId);
  const [isUndoingAll, setIsUndoingAll] = useState(false);

  const handleUndoAll = useCallback(async () => {
    const confirmed = await confirmDestructiveAction({
      title: tCommon("actions.undoAll"),
      message: tCommon("confirmation.undoAllChanges", {
        count: pendingCount,
      }),
      okLabel: tCommon("actions.undoAll"),
      cancelLabel: tCommon("actions.cancel"),
    });
    if (!confirmed) return;

    setIsUndoingAll(true);
    try {
      await onUndoAll();
    } finally {
      setIsUndoingAll(false);
    }
  }, [tCommon, pendingCount, onUndoAll]);

  const canUndoAll = pendingCount > 0 && !isUndoingAll;

  const diffHeaderContent = useMemo(
    () => ({
      content:
        activeTab === "diff" ? (
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
        ) : null,
      trailing:
        activeTab === "diff" && pillMode === "all-changes" ? (
          <div className="flex items-center gap-px">
            {canUndoAll ? (
              <Button
                htmlType="button"
                variant="tertiary"
                size="small"
                iconOnly
                className="flex-shrink-0"
                onClick={handleUndoAll}
                title={tCommon("actions.undoAll")}
                icon={<RotateCcw size={14} />}
              />
            ) : null}
            {canUndoAll ? <div className="mx-2 h-5 w-px bg-border-2" /> : null}
            <Button
              htmlType="button"
              variant="tertiary"
              size="small"
              iconOnly
              className="flex-shrink-0"
              onClick={handleCollapseAll}
              title={tCommon("actions.collapseAll")}
              icon={<ListChevronsDownUp size={14} />}
            />
          </div>
        ) : undefined,
    }),
    [
      activeTab,
      pillMode,
      handlePillModeChange,
      handleUndoAll,
      canUndoAll,
      handleCollapseAll,
      tCommon,
    ]
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
  const orgtrackSubmissionCommits = useMemo(
    () =>
      orgtrackCommitLinks.map((link) =>
        commitLinkToSubmissionCommit(link, fallbackRepoContext)
      ),
    [fallbackRepoContext, orgtrackCommitLinks]
  );

  useEffect(() => {
    logger.info("submission artifacts derived", {
      eventCount: simulatorEvents.length,
      commitCount: orgtrackSubmissionCommits.length,
      replayCommitCount: submissionsData.commits.length,
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
    orgtrackSubmissionCommits.length,
    submissionsData.commits.length,
    submissionsData.pullRequests.length,
  ]);

  const [resolvedSubmissionCommits, setResolvedSubmissionCommits] = useState<
    SubmissionCommit[]
  >([]);
  const [resolvedForCommits, setResolvedForCommits] = useState<
    SubmissionCommit[] | null
  >(null);
  const submissionsResolved = resolvedForCommits === orgtrackSubmissionCommits;

  useEffect(() => {
    let cancelled = false;

    async function resolveSubmissionsAgainstGitHistory() {
      logger.info("resolving submission commits against git history", {
        submissionCount: orgtrackSubmissionCommits.length,
        fallbackRepoContext,
      });

      const resolvedByContextKey = new Map<string, GitCommitInfo[]>();

      async function loadHistory(
        context: SubmissionRepoContext,
        contextKey: string
      ): Promise<GitCommitInfo[]> {
        let commits = resolvedByContextKey.get(contextKey);
        if (commits) return commits;
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
        });
        return commits;
      }

      const nextCommits = await Promise.all(
        orgtrackSubmissionCommits.map(async (submission) => {
          const primaryContext = {
            repoId: submission.repoId ?? fallbackRepoContext.repoId,
            repoPath: submission.repoPath ?? fallbackRepoContext.repoPath,
          };

          // The session's repo context can point at a non-git working
          // directory (or the wrong repo) — e.g. a chat session whose cwd
          // is not where the agent actually committed. Search the primary
          // context first, then fall back to every known workspace repo so
          // the commit card still resolves to the repo that owns the SHA.
          const candidateContexts: SubmissionRepoContext[] = [];
          const seenKeys = new Set<string>();
          const pushCandidate = (context: SubmissionRepoContext) => {
            const key = getRepoContextKey(context);
            if (!key || seenKeys.has(key)) return;
            seenKeys.add(key);
            candidateContexts.push(context);
          };
          pushCandidate(primaryContext);
          for (const repo of repos) {
            const path = repo.fs_uri ?? repo.path;
            if (path) pushCandidate({ repoId: repo.id, repoPath: path });
          }

          if (candidateContexts.length === 0) {
            logger.warn("submission commit missing repo context", {
              parsedSha: submission.sha,
              parsedSummary: submission.summary,
              fallbackRepoContext,
            });
            return mergeResolvedCommit(submission, undefined, primaryContext);
          }

          for (const context of candidateContexts) {
            const contextKey = getRepoContextKey(context);
            if (!contextKey) continue;
            const commits = await loadHistory(context, contextKey);
            const resolvedCommit = commits.find((candidate) =>
              commitMatchesSubmission(candidate, submission)
            );
            if (resolvedCommit) {
              logger.info("submission commit matched git history", {
                parsedSha: submission.sha,
                resolvedSha: resolvedCommit.sha,
                resolvedShortSha: resolvedCommit.short_sha,
                resolvedSummary: resolvedCommit.summary,
                context,
              });
              return mergeResolvedCommit(submission, resolvedCommit, context);
            }
          }

          logger.warn("submission commit did not match any repo history", {
            parsedSha: submission.sha,
            parsedSummary: submission.summary,
            candidateCount: candidateContexts.length,
          });
          return mergeResolvedCommit(submission, undefined, primaryContext);
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
        setResolvedForCommits(orgtrackSubmissionCommits);
      }
    }

    void resolveSubmissionsAgainstGitHistory();

    return () => {
      cancelled = true;
    };
  }, [fallbackRepoContext, orgtrackSubmissionCommits, repos]);

  const submissionCommits = useMemo(() => {
    if (submissionsResolved) {
      return resolvedSubmissionCommits.filter(
        (commit) => commit.author !== null
      );
    }
    return resolvedSubmissionCommits.length > 0
      ? resolvedSubmissionCommits
      : orgtrackSubmissionCommits;
  }, [
    resolvedSubmissionCommits,
    orgtrackSubmissionCommits,
    submissionsResolved,
  ]);
  const hasSubmissions =
    submissionCommits.length > 0 || submissionsData.pullRequests.length > 0;

  const tabs = useMemo<ReplayTab[]>(() => {
    const formatLabel = (base: string, count: number) =>
      count > 0 ? `${base} (${count})` : base;
    const submissionCount =
      submissionCommits.length + submissionsData.pullRequests.length;
    return [
      {
        eventId: TAB_IDS.diff,
        kind: "diff-filter",
        label: formatLabel(
          t("simulator.replay.diffApp.tabLabel"),
          finalDiffCount
        ),
        title: t("simulator.replay.diffApp.tabLabel"),
        icon: <GitBranch size={14} className="shrink-0" />,
      },
      {
        eventId: TAB_IDS.submissions,
        kind: "diff-filter",
        label: formatLabel(
          t("simulator.replay.diffApp.submissions.tabLabel"),
          submissionCount
        ),
        title: t("simulator.replay.diffApp.submissions.tabLabel"),
        icon: <Send size={14} className="shrink-0" />,
      },
    ];
  }, [
    finalDiffCount,
    submissionCommits.length,
    submissionsData.pullRequests.length,
    t,
  ]);

  usePublishWorkstationTabHeader({
    host: "simulator",
    content: diffHeaderContent,
    enabled: finalDiffCount > 0 || hasSimulatorDiffs || hasSubmissions,
  });

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

  useEffect(() => {
    if (!diffCommitNavigationRequest?.commitSha) return;
    if (
      diffCommitNavigationRequest.sessionId &&
      sessionId &&
      diffCommitNavigationRequest.sessionId !== sessionId
    ) {
      return;
    }

    const requestedSha = diffCommitNavigationRequest.commitSha;
    let cancelled = false;

    // A commit reached via a chat-message reference card may not exist in
    // any submission list (those only carry commits this session actually
    // produced). Resolve the SHA directly against every registered repo's
    // git history so the diff renders regardless of where it was committed.
    const candidateContexts: SubmissionRepoContext[] = [];
    const seenKeys = new Set<string>();
    const pushCandidate = (context: SubmissionRepoContext) => {
      const key = getRepoContextKey(context);
      if (!key || seenKeys.has(key)) return;
      seenKeys.add(key);
      candidateContexts.push(context);
    };
    pushCandidate(fallbackRepoContext);
    for (const repo of repos) {
      const path = repo.fs_uri ?? repo.path;
      if (path) pushCandidate({ repoId: repo.id, repoPath: path });
    }

    async function resolveAndSelect() {
      for (const context of candidateContexts) {
        if (cancelled) return;
        const contextKey = getRepoContextKey(context);
        if (!contextKey) continue;
        const result = await getGitCommits({
          repo_id: context.repoId ?? context.repoPath ?? "",
          repo_path: context.repoPath,
          limit: SUBMISSION_COMMIT_RESOLVE_LIMIT,
        });
        const match = (result?.commits ?? []).find(
          (candidate) =>
            candidate.sha
              .toLowerCase()
              .startsWith(requestedSha.toLowerCase()) ||
            candidate.short_sha.toLowerCase() === requestedSha.toLowerCase()
        );
        if (match) {
          if (cancelled) return;
          setActiveTab("submissions");
          handleSubmissionCommitSelect({
            sha: match.sha,
            short_sha: match.short_sha,
            summary: match.summary,
            author: match.author,
            repoId: context.repoId,
            repoPath: context.repoPath,
          });
          setDiffCommitNavigationRequest(null);
          return;
        }
      }
      // Not found anywhere — clear the request so it doesn't retry forever.
      if (!cancelled) setDiffCommitNavigationRequest(null);
    }

    void resolveAndSelect();

    return () => {
      cancelled = true;
    };
  }, [
    diffCommitNavigationRequest,
    fallbackRepoContext,
    handleSubmissionCommitSelect,
    repos,
    sessionId,
    setDiffCommitNavigationRequest,
  ]);

  // Per-round scope from the chat `TurnFilesFooter`. When a new scope arrives
  // for this session, drop into the all-changes diff view (the only mode that
  // renders the filtered consolidated list) and scroll to the clicked row, if
  // any. `nonce` is part of the dep set so re-clicking the same file refocuses.
  useEffect(() => {
    if (!isDiffScopeActive(diffScopeRequest, sessionId)) return;
    setActiveTab("diff");
    setPillMode("all-changes");
    setHistorySelection(null);
    setHistoryRepoContext(null);
    const selected = resolveScopedSelectedPath(diffScopeRequest, sessionId);
    if (selected) {
      setFocusedDiffPath(selected);
      setFocusedDiffNonce((prev) => prev + 1);
    } else {
      setFocusedDiffPath(null);
    }
  }, [diffScopeRequest, sessionId]);

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
                historySelection || pillMode === "all-changes"
                  ? null
                  : (selectedEntryId ?? displayEntry?.entryId ?? null)
              }
              selectedPath={
                historySelection || pillMode !== "all-changes"
                  ? null
                  : focusedDiffPath
              }
              onSelectItem={handleSidebarItemSelect}
            />
          ),
          defaultFlexGrow: 1,
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
      pillMode,
      focusedDiffPath,
      handleSidebarItemSelect,
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

    if (activeTab === "submissions") {
      if (!hasSubmissions) {
        return (
          <Placeholder
            variant="empty"
            placement="detail-panel"
            title={t(
              "simulator.replay.diffApp.submissions.empty",
              "No submissions yet."
            )}
            fillParentHeight
          />
        );
      }

      return (
        <div className="flex h-full min-h-0 flex-col overflow-auto">
          <SubmissionCommitsContent
            commits={submissionCommits}
            selectedCommitSha={
              historySelection?.type === "pr"
                ? (historySelection.selectedCommitSha ?? null)
                : historySelection?.type === "stash"
                  ? historySelection.commitSha
                  : null
            }
            onCommitSelect={handleSubmissionCommitSelect}
            emptyLabel={t(
              "simulator.replay.diffApp.submissions.noCommits",
              "No commits yet."
            )}
          />
          <SubmissionPullRequestsContent
            pullRequests={submissionsData.pullRequests}
            emptyLabel={t(
              "simulator.replay.diffApp.submissions.noPullRequests",
              "No pull requests yet."
            )}
          />
        </div>
      );
    }

    if (pillMode === "all-changes") {
      return (
        <DiffSectionList
          sections={consolidatedSections}
          loading={orgtrackFinalDiffsLoading}
          emptyTitle={t(
            "simulator.replay.diffApp.emptyForFilter",
            "No diffs yet"
          )}
          focusedPath={focusedDiffPath}
          focusedNonce={focusedDiffNonce}
          collapseSignal={collapseAllSignal}
          hideBottomPadding
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
        flat
        hideBottomPadding
      />
    );
  }, [
    historySelection,
    historyRepoContext,
    fallbackRepoContext,
    tCommon,
    activeTab,
    hasSubmissions,
    submissionCommits,
    submissionsData.pullRequests,
    handleSubmissionCommitSelect,
    pillMode,
    consolidatedSections,
    focusedSections,
    isCurrentEventLoading,
    orgtrackFinalDiffsLoading,
    focusedDiffPath,
    focusedDiffNonce,
    collapseAllSignal,
    t,
  ]);

  // A commit-detail selection (or a pending navigation request from a chat
  // reference card) must keep the replay shell mounted even when the session
  // itself produced no diffs/submissions — otherwise the navigated commit's
  // detail panel never gets a chance to render.
  const hasActiveCommitDetail =
    historySelection?.type === "commit" ||
    Boolean(diffCommitNavigationRequest?.commitSha);

  if (
    finalDiffCount === 0 &&
    !hasSimulatorDiffs &&
    !hasSubmissions &&
    !hasActiveCommitDetail
  ) {
    return (
      <SimulatorReplayChrome
        tabs={tabs}
        activeEventId={TAB_IDS[activeTab]}
        onTabClick={handleTabClick}
      >
        <div className="min-h-0 flex-1">
          {orgtrackFinalDiffsLoading ? (
            <Placeholder
              variant="loading"
              placement="detail-panel"
              fillParentHeight
            />
          ) : (
            <NoTabsPlaceholder
              icon="editor"
              caption={simulatorAwaitingAgentCaption}
              actions={simulatorPlaceholderActions}
            />
          )}
        </div>
      </SimulatorReplayChrome>
    );
  }

  return (
    <SimulatorReplayChrome
      tabs={tabs}
      activeEventId={TAB_IDS[activeTab]}
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
