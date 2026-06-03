import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { OrchestratorConfig } from "@src/api/http/project";
import type { TabPillItem } from "@src/components/TabPill";
import { createLogger } from "@src/hooks/logger";
import {
  resolveImagePathsForDisplay,
  unresolveImagePathsForStorage,
} from "@src/modules/ProjectManager/shared/utils/workItemImagePaths";
import type { Person } from "@src/types/core/shared";
import type {
  TodoItem,
  WorkItem as WorkItemExtended,
} from "@src/types/core/workItem";

import { CONTENT_TAB_KEYS, type ContentTab } from "../types";
import { useWorkItemTimeline } from "../useWorkItemTimeline";

const logger = createLogger("useWorkItemContentState");

interface UseWorkItemContentStateOptions {
  workItem: WorkItemExtended;
  onUpdateWorkItem?: (updates: Partial<WorkItemExtended>) => void;
  onUpdateWorkItemImmediate?: (updates: Partial<WorkItemExtended>) => void;
  currentUserProp?: Person;
  teamMembers?: Person[];
  projectSlug?: string | null;
  shortId?: string | null;
  onStartAgent?: (instructions?: string) => void;
  onOpenSession?: (sessionId: string) => void;
  activeAgentSessionId?: string | null;
}

export function useWorkItemContentState(
  options: UseWorkItemContentStateOptions
) {
  const {
    workItem,
    onUpdateWorkItem,
    onUpdateWorkItemImmediate,
    currentUserProp,
    teamMembers = [],
    projectSlug,
    shortId: _shortId,
    onStartAgent,
    onOpenSession,
    activeAgentSessionId,
  } = options;

  const { t } = useTranslation("projects");

  const currentUser = currentUserProp ?? {
    id: "current",
    name: t("workItems.activity.you"),
    color: "#52c41a",
  };

  const [activeTab, setActiveTab] = useState<ContentTab>("details");
  const [commentText, setCommentText] = useState("");
  const [isSubscribed, setIsSubscribed] = useState(true);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  const currentPhase = workItem.orchestratorState?.current_phase ?? "idle";
  const isAgentRunning = currentPhase === "sde" || currentPhase === "review";

  const launcherShouldCollapse = currentPhase !== "idle";
  const [launcherUserExpanded, setLauncherUserExpanded] = useState(false);
  const launcherCollapsed = launcherShouldCollapse && !launcherUserExpanded;
  const handleToggleLauncher = useCallback(() => {
    setLauncherUserExpanded((prev) => !prev);
  }, []);

  const pendingOpenChatRef = useRef(false);

  const handleStartAgentAndOpenChat = useCallback(
    (instructions?: string) => {
      pendingOpenChatRef.current = true;
      onStartAgent?.(instructions);
    },
    [onStartAgent]
  );

  useEffect(() => {
    if (
      pendingOpenChatRef.current &&
      activeAgentSessionId &&
      activeAgentSessionId !== "pending" &&
      onOpenSession
    ) {
      pendingOpenChatRef.current = false;
      onOpenSession(activeAgentSessionId);
    }
  }, [activeAgentSessionId, onOpenSession]);

  const prevSessionIdRef = useRef(activeAgentSessionId);
  useEffect(() => {
    if (
      pendingOpenChatRef.current &&
      prevSessionIdRef.current &&
      !activeAgentSessionId
    ) {
      pendingOpenChatRef.current = false;
    }
    prevSessionIdRef.current = activeAgentSessionId;
  }, [activeAgentSessionId]);

  const tabItems: TabPillItem[] = useMemo(
    () =>
      CONTENT_TAB_KEYS.map((key) => ({
        key,
        label: t(`common:labels.${key}`),
        dataTestId: `work-item-tab-${key}`,
        badge:
          key === "execution" && isAgentRunning ? (
            <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary-6" />
          ) : undefined,
      })),
    [t, isAgentRunning]
  );

  // --- Description editor ---

  const [resolvedDescription, setResolvedDescription] = useState<string | null>(
    null
  );
  const rawDescription =
    workItem.spec || workItem.session_metadata?.file_change_summary || "";

  useEffect(() => {
    let cancelled = false;
    if (projectSlug && rawDescription) {
      resolveImagePathsForDisplay(rawDescription, projectSlug)
        .then((resolved) => {
          if (!cancelled) setResolvedDescription(resolved);
        })
        .catch(() => {
          if (!cancelled) setResolvedDescription(rawDescription);
        });
    } else {
      setResolvedDescription(rawDescription);
    }
    return () => {
      cancelled = true;
    };
  }, [rawDescription, projectSlug]);

  // --- Timeline ---

  const { timelineEntries, formatRelativeTime } = useWorkItemTimeline({
    workItem,
    teamMembers,
  });

  // --- Handlers ---

  const handleTitleChange = useCallback(
    (title: string) => {
      if (title === workItem.name) return;
      onUpdateWorkItem?.({ name: title });
    },
    [onUpdateWorkItem, workItem.name]
  );

  const handleDescriptionChange = useCallback(
    (text: string) => {
      const storable = unresolveImagePathsForStorage(text.trim());
      const current =
        workItem.spec || workItem.session_metadata?.file_change_summary || "";
      if (storable === current) return;
      onUpdateWorkItem?.({ spec: storable });
    },
    [
      onUpdateWorkItem,
      workItem.spec,
      workItem.session_metadata?.file_change_summary,
    ]
  );

  const handleTodosChange = useCallback(
    (updatedTodos: TodoItem[]) => {
      const todoUpdates = { todos: updatedTodos } as Partial<WorkItemExtended>;
      if (onUpdateWorkItemImmediate) {
        onUpdateWorkItemImmediate(todoUpdates);
        return;
      }
      onUpdateWorkItem?.(todoUpdates);
    },
    [onUpdateWorkItem, onUpdateWorkItemImmediate]
  );

  const handleOrchestratorConfigUpdate = useCallback(
    (updates: Partial<OrchestratorConfig>) => {
      onUpdateWorkItem?.({
        orchestratorConfig: {
          ...(workItem.orchestratorConfig ?? {}),
          ...updates,
        },
      } as Partial<WorkItemExtended>);
    },
    [workItem, onUpdateWorkItem]
  );

  const handleCommentSubmit = useCallback(async () => {
    if (!commentText.trim() || isSubmittingComment) return;

    setIsSubmittingComment(true);
    try {
      const newComment = {
        id: `cmt-${Date.now()}`,
        author: currentUser.name,
        content: commentText.trim(),
        created_at: new Date().toISOString(),
      };
      onUpdateWorkItem?.({
        comments: [...(workItem.comments ?? []), newComment],
      } as Partial<WorkItemExtended>);
      setCommentText("");
    } catch (err) {
      logger.error("Failed to create comment", err);
    } finally {
      setIsSubmittingComment(false);
    }
  }, [
    commentText,
    isSubmittingComment,
    workItem,
    currentUser.name,
    onUpdateWorkItem,
  ]);

  return {
    currentUser,
    activeTab,
    setActiveTab,
    commentText,
    setCommentText,
    isSubscribed,
    setIsSubscribed,
    isSubmittingComment,
    currentPhase,
    isAgentRunning,
    launcherCollapsed,
    launcherShouldCollapse,
    handleToggleLauncher,
    handleStartAgentAndOpenChat,
    tabItems,
    resolvedDescription,
    rawDescription,
    timelineEntries,
    formatRelativeTime,
    handleTitleChange,
    handleDescriptionChange,
    handleTodosChange,
    handleOrchestratorConfigUpdate,
    handleCommentSubmit,
  };
}
