/**
 * CreatePlanCard — Card-style plan display for the `create_plan` tool.
 *
 * Inline editing: "Edit" replaces the markdown preview with a textarea.
 * "Build" approves the plan; "Skip" rejects it without starting Build.
 */
import type { TFunction } from "i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { CheckCircle2, Pencil, X, XCircle } from "lucide-react";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { respondPlanApproval } from "@src/api/tauri/agent";
import Button from "@src/components/Button";
import Markdown from "@src/components/MarkDown";
import Message from "@src/components/Message";
import { getToolIcon } from "@src/config/toolIcons";
import {
  type PlanApprovalStatus,
  type PlanSurface,
  type PlanSurfaceState,
  shouldDefaultCollapsePlanCard,
} from "@src/engines/SessionCore/derived/planDisplayEvents";
import { useMountedCleanup } from "@src/hooks/lifecycle/useMounted";
import { currentRepoAtom } from "@src/store/repo";
import { sessionRuntimeStatusAtom } from "@src/store/session/cliSessionStatusAtom";
import { creatorDefaultModelSelectionAtom } from "@src/store/session/creatorDefaultModelAtom";
import {
  clearPendingPlanApproval,
  pendingPlanApprovalsAtom,
} from "@src/store/session/planApprovalAtom";
import { sessionByIdAtom } from "@src/store/session/sessionAtom";
import { activeSessionIdAtom } from "@src/store/session/viewAtom";
import { resolveModelForMessage } from "@src/util/session/resolveModelForMessage";

import {
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderSubtitle,
  EventBlockHeaderTitle,
  getEventBlockContainerClasses,
} from "../primitives";
import { useBlockHeader } from "../useBlockLocate";

const PLAN_ICON_SIZE = 14;
const PLAN_ICON = getToolIcon("create_plan", { size: PLAN_ICON_SIZE });

function deriveDisplayTitle(title: string, content: string): string {
  const trimmedTitle = title.trim();
  if (trimmedTitle) return trimmedTitle;

  const headingMatch = content.match(/^\s*#\s+(.+)$/m);
  return headingMatch?.[1]?.trim() ?? "";
}

function getPlanStateLabel(
  t: TFunction<"sessions">,
  status: PlanApprovalStatus,
  isStreaming: boolean,
  ready: boolean
): string {
  if (isStreaming) return t("planDoc.drafting");
  if (status === "approved") return t("planDoc.built");
  if (status === "archived") return t("planDoc.archived");
  if (status === "cancelled") return t("planDoc.cancelled");
  if (ready) return t("planDoc.readyForReview");
  return t("planDoc.idle");
}

export interface CreatePlanCardProps {
  content: string;
  title: string;
  isStreaming: boolean;
  /** Tool execution call id; kept only for transcript/tool correlation. */
  toolCallId?: string;
  /** Stable pending approval slot id authored by the backend. */
  planId?: string;
  /** Active plan-card revision id authored by the backend. */
  planRevisionId?: string;
  sessionId?: string;
  eventId?: string;
  surface?: PlanSurface;
  approvalStatus?: PlanApprovalStatus;
  ownsPendingPlan?: boolean;
  surfaceState?: PlanSurfaceState;
  onOpenPreview?: () => void;
  /**
   * Current-surface only: when true, the card is hidden and the parent
   * is expected to render a pill in `CollapsedInlineRow` instead. The
   * card un-mounts entirely so its action buttons don't keep capturing
   * keyboard shortcuts.
   */
  collapsed?: boolean;
  /**
   * Current-surface only: triggered when the user clicks the in-header
   * X button to collapse the card into its pill representation.
   */
  onCollapse?: () => void;
}

const CreatePlanCard: React.FC<CreatePlanCardProps> = memo(
  ({
    content,
    title,
    isStreaming,
    toolCallId,
    planId: _planId,
    planRevisionId,
    sessionId: sessionIdProp,
    eventId,
    surface = "transcript",
    approvalStatus = "pending",
    ownsPendingPlan = false,
    surfaceState,
    onOpenPreview,
    collapsed = false,
    onCollapse,
  }) => {
    const { t } = useTranslation("sessions");
    const activeSessionId = useAtomValue(activeSessionIdAtom);
    const sessionId = sessionIdProp ?? activeSessionId;
    const approvalMap = useAtomValue(pendingPlanApprovalsAtom);
    const setPendingPlanApprovals = useSetAtom(pendingPlanApprovalsAtom);
    const runtimeStatus = useAtomValue(sessionRuntimeStatusAtom);
    // Read the plan's *own* session row for model+key — approving a
    // plan should not silently use whatever model the user happens to
    // have selected as their creator-default; it should resume the
    // session that produced the plan with that session's model.
    const planSession = useAtomValue(sessionByIdAtom(sessionId ?? ""));
    const creatorDefaultSelection = useAtomValue(
      creatorDefaultModelSelectionAtom
    );
    const currentRepo = useAtomValue(currentRepoAtom);
    const isCurrentSurface = surface === "current";
    const ownsActions =
      surfaceState?.ownsActions ?? (isCurrentSurface || ownsPendingPlan);
    const effectiveApprovalStatus = surfaceState?.status ?? approvalStatus;

    const {
      isCollapsed,
      isHeaderHovered,
      handleHeaderClick,
      handleHeaderMouseEnter,
      handleHeaderMouseLeave,
      handleLocate,
    } = useBlockHeader({
      eventId,
      defaultCollapsed: shouldDefaultCollapsePlanCard({ surface, isStreaming }),
    });

    const [submitting, setSubmitting] = useState(false);
    // Ref guards against double-submit during the async window before
    // setSubmitting(true) propagates — keeps the button disabled immediately.
    const submittingRef = useRef(false);
    const mountedRef = useRef(true);
    useMountedCleanup(mountedRef);

    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState(content);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Keep editedContent in sync when content streams in (only while not editing).
    useEffect(() => {
      if (!isEditing) setEditedContent(content);
    }, [content, isEditing]);

    const state = sessionId ? approvalMap.get(sessionId) : undefined;
    const cardRevisionId = planRevisionId || toolCallId;
    const idMatch =
      !!state?.current &&
      !!cardRevisionId &&
      (state.current.planRevisionId === cardRevisionId ||
        state.current.toolCallId === cardRevisionId);
    const ready =
      surfaceState?.readyForReview ??
      (idMatch && !isStreaming && effectiveApprovalStatus === "pending");
    const sessionIsWorking =
      sessionId === activeSessionId &&
      (runtimeStatus === "running" || runtimeStatus === "installing");
    const actionsDisabled = submitting || sessionIsWorking;
    const interactive =
      surfaceState?.actionable !== undefined
        ? surfaceState.actionable && !actionsDisabled
        : ownsActions && ready && !actionsDisabled;
    const hasEdits = isEditing && editedContent !== content;
    const displayTitle =
      deriveDisplayTitle(title, content) || t("planDoc.untitled");
    const stateLabel = getPlanStateLabel(
      t,
      effectiveApprovalStatus,
      isStreaming,
      ready
    );
    const handlePreviewNavigate =
      onOpenPreview ?? (eventId ? handleLocate : undefined);

    const handleSubmit = useCallback(
      async (
        choice: "approve" | "approve_with_edits" | "reject",
        edited?: string
      ) => {
        if (!sessionId || !interactive || submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        try {
          const sessionSelection = planSession
            ? {
                ...creatorDefaultSelection,
                keySource:
                  planSession.keySource ?? creatorDefaultSelection?.keySource,
                model: planSession.model ?? creatorDefaultSelection?.model,
                selectedAccountId:
                  planSession.accountId ??
                  creatorDefaultSelection?.selectedAccountId,
                cliAgentType:
                  planSession.cliAgentType ??
                  creatorDefaultSelection?.cliAgentType,
                tier: planSession.tier ?? creatorDefaultSelection?.tier,
              }
            : creatorDefaultSelection;
          const { model, accountId } = resolveModelForMessage(sessionSelection);
          // Plan approval uses the plan's own session row for repo path —
          // the global repo selection atom is only a fallback for older rows.
          // The session row's persisted repo is what `workspace_root` was set
          // to at create time; reading global selection would let two open
          // sessions on different repos collide whenever the user approves
          // a plan from the older one.
          const workspacePath =
            planSession?.repoPath ??
            currentRepo?.path ??
            currentRepo?.fs_uri ??
            undefined;
          await respondPlanApproval(sessionId, choice, edited, {
            model,
            accountId,
            workspacePath,
          });
          setPendingPlanApprovals((prev) =>
            clearPendingPlanApproval(prev, sessionId, cardRevisionId)
          );
          if (mountedRef.current) setIsEditing(false);
        } catch (err) {
          Message.error(
            err instanceof Error ? err.message : t("planDoc.buildFailed")
          );
        } finally {
          submittingRef.current = false;
          if (mountedRef.current) setSubmitting(false);
        }
      },
      [
        sessionId,
        interactive,
        planSession,
        creatorDefaultSelection,
        currentRepo,
        setPendingPlanApprovals,
        cardRevisionId,
        t,
        mountedRef,
      ]
    );

    const handleBuild = useCallback(() => {
      void handleSubmit(
        isEditing && hasEdits ? "approve_with_edits" : "approve",
        isEditing && hasEdits ? editedContent : undefined
      );
    }, [isEditing, hasEdits, editedContent, handleSubmit]);

    const handleSkip = useCallback(() => {
      void handleSubmit("reject");
    }, [handleSubmit]);

    const handleEditToggle = useCallback(() => {
      if (isEditing) {
        setIsEditing(false);
        setEditedContent(content);
      } else {
        if (isCollapsed) handleHeaderClick();
        setEditedContent(content);
        setIsEditing(true);
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    }, [isEditing, isCollapsed, handleHeaderClick, content]);

    if (!isStreaming && !ready && isCurrentSurface) return null;
    // Current-surface collapse is owned by `useComposerSections` —
    // returning null lets the pill row take over without leaving a
    // ghost card behind. Transcript surface ignores this prop.
    if (isCurrentSurface && collapsed) return null;

    const collapseButton =
      isCurrentSurface && onCollapse ? (
        <button
          type="button"
          data-testid="create-plan-collapse"
          onClick={(event) => {
            event.stopPropagation();
            onCollapse();
          }}
          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-fill-2 hover:text-text-1"
          title={t("planDoc.collapse")}
        >
          <X size={12} strokeWidth={2} />
        </button>
      ) : null;

    return (
      <div
        className={getEventBlockContainerClasses()}
        data-testid="create-plan-card"
        data-plan-ready={ready ? "true" : "false"}
        data-plan-surface={surface}
        data-plan-revision-id={cardRevisionId}
        data-plan-approval-status={effectiveApprovalStatus}
        data-plan-actions-disabled={actionsDisabled ? "true" : "false"}
        data-plan-collapsed={isCollapsed ? "true" : "false"}
      >
        <EventBlockHeader
          isCollapsed={isCollapsed}
          withHover
          onClick={handleLocate}
          onNavigate={handlePreviewNavigate}
          onMouseEnter={handleHeaderMouseEnter}
          onMouseLeave={handleHeaderMouseLeave}
          rightContent={collapseButton}
        >
          <EventBlockHeaderIcon
            icon={PLAN_ICON}
            isCollapsed={isCollapsed}
            isHeaderHovered={isHeaderHovered}
            iconSize={PLAN_ICON_SIZE}
            onToggle={handleHeaderClick}
            hasContent
            revealChevronOnIconHoverOnly={Boolean(eventId)}
            isLoading={isStreaming}
          />
          <EventBlockHeaderTitle isLoading={isStreaming}>
            {stateLabel}
          </EventBlockHeaderTitle>
          <EventBlockHeaderSubtitle
            isLoading={isStreaming}
            title={displayTitle}
          >
            {displayTitle}
          </EventBlockHeaderSubtitle>
        </EventBlockHeader>

        {!isCollapsed &&
          (isEditing ? (
            <div className="px-3 py-2">
              <textarea
                ref={textareaRef}
                className="scrollbar-overlay h-[280px] w-full resize-y rounded-md border border-border-2 bg-bg-1 px-3 py-2 text-[13px] leading-relaxed text-text-1 outline-none focus:border-primary-6"
                value={editedContent}
                onChange={(event) => setEditedContent(event.target.value)}
                spellCheck={false}
              />
            </div>
          ) : (
            <div
              className={`overflow-y-auto overflow-x-hidden px-3 py-2 ${ready ? "max-h-[280px]" : "max-h-[160px]"}`}
            >
              {content.trim() ? (
                <Markdown textContent={content} />
              ) : (
                <span className="chat-block-content text-text-3">
                  {t("planDoc.emptyPlan")}
                </span>
              )}
            </div>
          ))}

        {ownsActions && (
          <div className="flex items-center justify-end gap-2 border-t border-fill-3 px-3 py-2">
            {ready && (
              <Button
                size="mini"
                data-testid="create-plan-skip"
                onClick={handleSkip}
                disabled={!interactive || submitting}
                icon={<XCircle size={12} />}
              >
                {t("planDoc.skip")}
              </Button>
            )}
            {ready && (
              <Button
                size="mini"
                data-testid="create-plan-edit"
                onClick={handleEditToggle}
                disabled={actionsDisabled}
                icon={isEditing ? <X size={12} /> : <Pencil size={12} />}
              >
                {isEditing ? t("planDoc.cancelEdit") : t("planDoc.edit")}
              </Button>
            )}
            <Button
              variant="primary"
              size="mini"
              data-testid="create-plan-build"
              onClick={handleBuild}
              disabled={!interactive || submitting}
              icon={<CheckCircle2 size={12} />}
            >
              {isEditing && hasEdits
                ? t("planDoc.editAndBuild")
                : t("planDoc.build")}
            </Button>
          </div>
        )}
      </div>
    );
  }
);

CreatePlanCard.displayName = "CreatePlanCard";

export default CreatePlanCard;
