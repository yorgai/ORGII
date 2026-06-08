import {
  ArrowLeft,
  CircleDot,
  ExternalLink,
  Loader,
  MessageSquare,
  XCircle,
} from "lucide-react";
import React, { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GitHubIssue, GitHubIssueComment } from "@src/api/tauri/github";
import Avatar from "@src/components/Avatar";
import Button from "@src/components/Button";
import Textarea from "@src/components/Textarea";
import {
  HEADER_BUTTON,
  HEADER_CLASSES,
  HEADER_ICON_SIZE,
  TYPOGRAPHY,
} from "@src/config/workstation/tokens";
import {
  formatTimeAgo,
  getLabelColorStyle,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/hooks/workstationIssueHelpers";

interface IssueDetailPanelProps {
  issue: GitHubIssue;
  comments: GitHubIssueComment[];
  commentsLoading: boolean;
  submittingComment: boolean;
  onClose: () => void;
  onCloseIssue: () => void;
  onReopenIssue: () => void;
  onAddComment: (body: string) => Promise<void>;
}

export const IssueDetailPanel: React.FC<IssueDetailPanelProps> = memo(
  ({
    issue,
    comments,
    commentsLoading,
    submittingComment,
    onClose,
    onCloseIssue,
    onReopenIssue,
    onAddComment,
  }) => {
    const { t } = useTranslation("common");
    const [commentBody, setCommentBody] = useState("");
    const isOpen = issue.state === "open";

    const handleCommentSubmit = useCallback(async () => {
      const body = commentBody.trim();
      if (!body || submittingComment) return;
      await onAddComment(body);
      setCommentBody("");
    }, [commentBody, submittingComment, onAddComment]);

    const handleOpenUrl = useCallback(() => {
      if (issue.html_url) {
        window.open(issue.html_url, "_blank", "noopener,noreferrer");
      }
    }, [issue.html_url]);

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {/* ── Header bar ─────────────────────────────────────────────────── */}
        <div className={HEADER_CLASSES.pageHeader}>
          <button
            type="button"
            onClick={onClose}
            className={HEADER_BUTTON.action}
            title={t("actions.back", "Back")}
          >
            <ArrowLeft size={HEADER_ICON_SIZE.sm} strokeWidth={2} />
          </button>

          {/* Issue number badge */}
          <span
            className={`shrink-0 rounded px-1 py-[1px] font-mono ${TYPOGRAPHY.secondary} bg-fill-2 text-text-3`}
          >
            #{issue.number}
          </span>

          {/* Title — truncated in the header */}
          <span
            className={`min-w-0 flex-1 truncate ${TYPOGRAPHY.sectionTitle} text-text-1`}
            title={issue.title}
          >
            {issue.title}
          </span>

          {/* Status action — close / reopen as a very small ghost button */}
          {isOpen ? (
            <button
              type="button"
              onClick={onCloseIssue}
              className={`shrink-0 rounded px-1.5 py-[3px] ${TYPOGRAPHY.secondary} text-text-3 transition-colors hover:bg-fill-2 hover:text-text-1`}
              title="Close issue"
            >
              Close
            </button>
          ) : (
            <button
              type="button"
              onClick={onReopenIssue}
              className={`shrink-0 rounded px-1.5 py-[3px] ${TYPOGRAPHY.secondary} text-success-6 transition-colors hover:bg-success-1`}
              title="Reopen issue"
            >
              Reopen
            </button>
          )}

          <button
            type="button"
            onClick={handleOpenUrl}
            className={HEADER_BUTTON.action}
            title="Open in GitHub"
          >
            <ExternalLink size={12} strokeWidth={2} />
          </button>
        </div>

        {/* ── Scrollable content ──────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* ── Issue title + status ──────────────────────────────────────── */}
          <div className="flex flex-col gap-2 px-4 pb-3 pt-4">
            {/* Status pill + full title */}
            <div className="flex flex-wrap items-start gap-2">
              <span
                className={`mt-px inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[3px] ${TYPOGRAPHY.badge} ${
                  isOpen
                    ? "text-success-7 bg-success-1"
                    : "bg-fill-2 text-text-3"
                }`}
              >
                {isOpen ? (
                  <CircleDot size={11} strokeWidth={2} />
                ) : (
                  <XCircle size={11} strokeWidth={2} />
                )}
                {isOpen ? "Open" : "Closed"}
              </span>
              <h2
                className={`min-w-0 flex-1 ${TYPOGRAPHY.sectionTitle} leading-[1.4] text-text-1`}
              >
                {issue.title}
              </h2>
            </div>

            {/* Author row */}
            <div
              className={`flex items-center gap-1.5 ${TYPOGRAPHY.secondary} text-text-3`}
            >
              <Avatar size={16} src={issue.user.avatar_url} />
              <span className="font-medium text-text-2">
                {issue.user.login}
              </span>
              <span>opened {formatTimeAgo(issue.created_at)}</span>
              {comments.length > 0 && (
                <span className="ml-auto flex items-center gap-0.5">
                  <MessageSquare size={11} strokeWidth={1.75} />
                  <span>{comments.length}</span>
                </span>
              )}
            </div>

            {/* Labels */}
            {issue.labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {issue.labels.map((label) => {
                  const style = getLabelColorStyle(label.color);
                  return (
                    <span
                      key={label.id}
                      className={`rounded-full px-2 py-[2px] ${TYPOGRAPHY.badge} leading-tight`}
                      style={style}
                    >
                      {label.name}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Assignees */}
            {issue.assignees.length > 0 && (
              <div
                className={`flex flex-wrap items-center gap-1.5 ${TYPOGRAPHY.secondary} text-text-3`}
              >
                <span className="text-text-3">Assigned to</span>
                <div className="flex items-center gap-1">
                  {issue.assignees.map((user) => (
                    <span
                      key={user.login}
                      className="flex items-center gap-1 rounded-full bg-fill-2 px-1.5 py-[2px]"
                    >
                      <Avatar size={12} src={user.avatar_url} />
                      <span className="text-text-2">{user.login}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Issue body ────────────────────────────────────────────────── */}
          {issue.body ? (
            <div className="border-t border-border-1 px-4 py-3">
              <p
                className={`whitespace-pre-wrap ${TYPOGRAPHY.value} leading-relaxed text-text-1`}
              >
                {issue.body}
              </p>
            </div>
          ) : null}

          {/* ── Comments section ──────────────────────────────────────────── */}
          <div className="flex flex-1 flex-col border-t border-border-1">
            {/* Section heading */}
            <div className="px-4 pb-1 pt-3">
              <span
                className={`${TYPOGRAPHY.secondary} font-medium uppercase tracking-wide text-text-3`}
              >
                {commentsLoading
                  ? "Comments"
                  : `Comments${comments.length > 0 ? ` (${comments.length})` : ""}`}
              </span>
            </div>

            {commentsLoading ? (
              <div className="flex items-center justify-center py-6 text-text-3">
                <Loader size={14} className="animate-spin" />
              </div>
            ) : comments.length === 0 ? (
              <div
                className={`px-4 py-2 ${TYPOGRAPHY.secondary} italic text-text-3`}
              >
                No comments yet
              </div>
            ) : (
              <div className="flex flex-col">
                {comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="flex gap-2.5 border-b border-border-1 px-4 py-3 last:border-b-0"
                  >
                    <div className="shrink-0 pt-[1px]">
                      <Avatar size={18} src={comment.user.avatar_url} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`mb-1 flex items-center gap-1.5 ${TYPOGRAPHY.secondary} text-text-3`}
                      >
                        <span className="font-medium text-text-2">
                          {comment.user.login}
                        </span>
                        <span>{formatTimeAgo(comment.created_at)}</span>
                      </div>
                      <p
                        className={`whitespace-pre-wrap ${TYPOGRAPHY.value} leading-relaxed text-text-1`}
                      >
                        {comment.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Comment composer ──────────────────────────────────────────── */}
          <div className="shrink-0 border-t border-border-1 px-4 py-3">
            <Textarea
              value={commentBody}
              onChange={setCommentBody}
              placeholder={t(
                "git.issues.commentPlaceholder",
                "Leave a comment…"
              )}
              rows={3}
              size="mini"
              resize="none"
              className="mb-2"
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                htmlType="button"
                variant="primary"
                size="mini"
                loading={submittingComment}
                disabled={!commentBody.trim() || submittingComment}
                onClick={() => void handleCommentSubmit()}
              >
                {t("git.issues.submitComment", "Comment")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

IssueDetailPanel.displayName = "IssueDetailPanel";
