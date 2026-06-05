/**
 * useComposerSections
 *
 * Manages expand/collapse state for all ComposerStack sections:
 *
 * Primary cards (question, permission, modeswitch) — always-visible when
 * active; collapse to a primary-6 pill at the front of the pill row.
 *
 * Secondary sections (queue, processes, files) — pill-only; one card open
 * at a time.
 *
 * Shared between ChatView and PlaygroundChatPanel.
 */
import {
  ArrowLeftRight,
  BellRing,
  CircleHelp,
  ClipboardList,
  Diff,
  MessageCircleMore,
  Terminal,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import type { InlineSection } from "../components/CollapsedInlineRow";

export interface FileChangeStats {
  count: number;
  additions: number;
  deletions: number;
}

export interface UseComposerSectionsOptions {
  sessionId?: string | null;
  queueCount: number;
  enqueueCount?: number;
  /** Whether the AskQuestionCard currently has pending data (controls pill visibility). */
  hasQuestion?: boolean;
  /** Whether the PermissionCard currently has pending data. */
  hasPermission?: boolean;
  /** Whether the ModeSwitchCard currently has pending data. */
  hasModeSwitch?: boolean;
  /** Whether the CreatePlanCard currently has a pending plan to review. */
  hasPlan?: boolean;
  /** When provided, clicking the files pill navigates directly instead of expanding the card. */
  onFilesExpand?: () => void;
}

type ActiveSection = "queue" | "process" | "files" | null;

export function useComposerSections({
  sessionId,
  queueCount,
  enqueueCount = 0,
  hasQuestion = false,
  hasPermission = false,
  hasModeSwitch = false,
  hasPlan = false,
  onFilesExpand,
}: UseComposerSectionsOptions) {
  // Primary card collapsed states
  const [questionCollapsed, setQuestionCollapsed] = useState(false);
  const [permissionCollapsed, setPermissionCollapsed] = useState(false);
  const [modeSwitchCollapsed, setModeSwitchCollapsed] = useState(false);
  const [planCollapsed, setPlanCollapsed] = useState(false);

  // Secondary section — only one card open at a time
  const [activeSection, setActiveSection] = useState<ActiveSection>(null);

  // Counts reported by child components
  const [processVisibleCount, setProcessVisibleCount] = useState(0);
  const [fileChangeStats, setFileChangeStatsState] = useState<FileChangeStats>({
    count: 0,
    additions: 0,
    deletions: 0,
  });
  const setFileChangeStats = useCallback((next: FileChangeStats) => {
    setFileChangeStatsState((current) =>
      current.count === next.count &&
      current.additions === next.additions &&
      current.deletions === next.deletions
        ? current
        : next
    );
  }, []);

  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  if (sessionId !== prevSessionId) {
    setPrevSessionId(sessionId);
    setActiveSection(null);
    setProcessVisibleCount(0);
    setFileChangeStats({ count: 0, additions: 0, deletions: 0 });
  }

  // Auto-expand queue when new messages arrive
  const [prevEnqueueCount, setPrevEnqueueCount] = useState(enqueueCount);
  if (enqueueCount !== prevEnqueueCount) {
    setPrevEnqueueCount(enqueueCount);
    if (enqueueCount > prevEnqueueCount) {
      setActiveSection("queue");
    }
  }

  // Restore collapsed → expanded when the card's data resets (new question, new permission, etc.)
  const [prevHasQuestion, setPrevHasQuestion] = useState(hasQuestion);
  if (hasQuestion !== prevHasQuestion) {
    setPrevHasQuestion(hasQuestion);
    if (hasQuestion) setQuestionCollapsed(false);
  }
  const [prevHasPermission, setPrevHasPermission] = useState(hasPermission);
  if (hasPermission !== prevHasPermission) {
    setPrevHasPermission(hasPermission);
    if (hasPermission) setPermissionCollapsed(false);
  }
  const [prevHasModeSwitch, setPrevHasModeSwitch] = useState(hasModeSwitch);
  if (hasModeSwitch !== prevHasModeSwitch) {
    setPrevHasModeSwitch(hasModeSwitch);
    if (hasModeSwitch) setModeSwitchCollapsed(false);
  }
  const [prevHasPlan, setPrevHasPlan] = useState(hasPlan);
  if (hasPlan !== prevHasPlan) {
    setPrevHasPlan(hasPlan);
    if (hasPlan) setPlanCollapsed(false);
  }

  const collapseQuestion = useCallback(() => setQuestionCollapsed(true), []);
  const expandQuestion = useCallback(() => setQuestionCollapsed(false), []);
  const collapsePermission = useCallback(
    () => setPermissionCollapsed(true),
    []
  );
  const expandPermission = useCallback(() => setPermissionCollapsed(false), []);
  const collapseModeSwitch = useCallback(
    () => setModeSwitchCollapsed(true),
    []
  );
  const expandModeSwitch = useCallback(() => setModeSwitchCollapsed(false), []);
  const collapsePlan = useCallback(() => setPlanCollapsed(true), []);
  const expandPlan = useCallback(() => setPlanCollapsed(false), []);

  const toggleQueue = useCallback(
    () => setActiveSection((prev) => (prev === "queue" ? null : "queue")),
    []
  );
  const toggleProcess = useCallback(
    () => setActiveSection((prev) => (prev === "process" ? null : "process")),
    []
  );
  const toggleFiles = useCallback(
    () => setActiveSection((prev) => (prev === "files" ? null : "files")),
    []
  );

  const queueExpanded = activeSection === "queue";
  const processExpanded = activeSection === "process";
  const filesExpanded = activeSection === "files";

  const hasQueue = queueCount > 0;
  const hasProcess = processVisibleCount > 0;
  const fileSectionCount = fileChangeStats.count;
  const hasFiles = fileSectionCount > 0;

  const hasAny =
    hasQueue ||
    hasProcess ||
    hasFiles ||
    (hasQuestion && questionCollapsed) ||
    (hasPermission && permissionCollapsed) ||
    (hasModeSwitch && modeSwitchCollapsed) ||
    (hasPlan && planCollapsed);

  const inlineSections = useMemo<InlineSection[]>(() => {
    const sections: InlineSection[] = [];

    // Primary pills — leading, primary-6 variant, icon + text label
    if (hasQuestion && questionCollapsed) {
      sections.push({
        key: "question",
        icon: React.createElement(CircleHelp, { size: 13 }),
        count: 0,
        label: "Question",
        active: false,
        variant: "primary",
        onExpand: expandQuestion,
      });
    }
    if (hasPermission && permissionCollapsed) {
      sections.push({
        key: "permission",
        icon: React.createElement(BellRing, { size: 13 }),
        count: 0,
        label: "Permission",
        active: false,
        variant: "primary",
        onExpand: expandPermission,
      });
    }
    if (hasModeSwitch && modeSwitchCollapsed) {
      sections.push({
        key: "modeswitch",
        icon: React.createElement(ArrowLeftRight, { size: 13 }),
        count: 0,
        label: "Mode Switch",
        active: false,
        variant: "primary",
        onExpand: expandModeSwitch,
      });
    }
    if (hasPlan && planCollapsed) {
      sections.push({
        key: "plan",
        icon: React.createElement(ClipboardList, { size: 13 }),
        count: 0,
        label: "Plan",
        active: false,
        variant: "primary",
        onExpand: expandPlan,
        testId: "composer-section-plan",
      });
    }

    // Secondary pills
    if (hasQueue) {
      sections.push({
        key: "queue",
        icon: React.createElement(MessageCircleMore, { size: 13 }),
        count: queueCount,
        active: queueExpanded,
        onExpand: toggleQueue,
        testId: "composer-section-queue",
      });
    }
    if (hasProcess) {
      sections.push({
        key: "process",
        icon: React.createElement(Terminal, { size: 13 }),
        count: processVisibleCount,
        active: processExpanded,
        onExpand: toggleProcess,
        testId: "composer-section-process",
      });
    }
    if (hasFiles) {
      const diffStatNodes: React.ReactNode[] = [];
      if (fileChangeStats.additions > 0) {
        diffStatNodes.push(
          React.createElement(
            "span",
            { key: "additions", className: "font-normal text-green-500" },
            `+${fileChangeStats.additions}`
          )
        );
      }
      if (fileChangeStats.deletions > 0) {
        diffStatNodes.push(
          React.createElement(
            "span",
            { key: "deletions", className: "font-normal text-red-500" },
            `-${fileChangeStats.deletions}`
          )
        );
      }
      sections.push({
        key: "files",
        icon: React.createElement(Diff, { size: 13 }),
        count: fileSectionCount,
        content: React.createElement(
          "span",
          { className: "inline-flex items-center gap-2" },
          React.createElement("span", null, fileSectionCount),
          diffStatNodes.length > 0
            ? React.createElement("span", {
                className:
                  "inline-block h-0.5 w-0.5 shrink-0 rounded-full bg-text-4",
                "aria-hidden": true,
              })
            : null,
          ...diffStatNodes
        ),
        active: filesExpanded,
        onExpand: () => {
          toggleFiles();
          onFilesExpand?.();
        },
        testId: "composer-section-files",
      });
    }

    return sections;
  }, [
    hasQuestion,
    questionCollapsed,
    hasPermission,
    permissionCollapsed,
    hasModeSwitch,
    modeSwitchCollapsed,
    hasPlan,
    planCollapsed,
    expandQuestion,
    expandPermission,
    expandModeSwitch,
    expandPlan,
    hasQueue,
    hasProcess,
    hasFiles,
    queueCount,
    processVisibleCount,
    fileSectionCount,
    fileChangeStats.additions,
    fileChangeStats.deletions,
    queueExpanded,
    processExpanded,
    filesExpanded,
    toggleQueue,
    toggleProcess,
    toggleFiles,
    onFilesExpand,
  ]);

  return {
    // Primary card collapse state
    questionCollapsed,
    permissionCollapsed,
    modeSwitchCollapsed,
    planCollapsed,
    collapseQuestion,
    collapsePermission,
    collapseModeSwitch,
    collapsePlan,
    // Secondary section state
    queueExpanded,
    processExpanded,
    filesExpanded,
    toggleQueue,
    toggleProcess,
    toggleFiles,
    hasAny,
    inlineSections,
    setProcessVisibleCount,
    setFileChangeStats,
  };
}
