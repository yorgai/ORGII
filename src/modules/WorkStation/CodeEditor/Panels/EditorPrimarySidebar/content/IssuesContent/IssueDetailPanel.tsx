import {
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

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {/* ── Header strip — mirrors CommitTabHeader height/style ─────────── */}
        <div className={HEADER_CLASSES.pageHeader}>
          <span
            className={`shrink-0 ${isOpen ? "text-success-6" : "text-text-3"}`}
          >
            {isOpen ? (
              <CircleDot size={HEADER_ICON_SIZE.sm} strokeWidth={2} />
            ) : (
              <XCircle size={HEADER_ICON_SIZE.sm} strokeWidth={2} />
            )}
          </span>

          <span className="shrink-0 font-mono text-[11px] text-text-3">
            #{issue.number}
          </span>

          <span
            className={`min-w-0 flex-1 truncate ${TYPOGRAPHY.sectionTitle} text-text-1`}
            title={issue.title}
          >
            {issue.title}
          </span>

          <a
            href={issue.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className={HEADER_BUTTON.action}
            title="Open on GitHub"
          >
            <ExternalLink size={12} strokeWidth={2} />
          </a>
        </div>

        {/* ── Info panel — fixed strip, mirrors CommitInfoPanel ───────────── */}
        <div className="flex max-h-48 flex-shrink-0 flex-col gap-2 border-b border-border-2 px-4 py-3">
          {/* Author + comment count row */}
          <div
            className={`flex flex-wrap items-center gap-1.5 ${TYPOGRAPHY.secondary} text-text-3`}
          >
            <Avatar size={16} src={issue.user.avatar_url} />
            <span className="font-medium text-text-2">{issue.user.login}</span>
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
              <span>Assigned to</span>
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

          {/* Issue body — same text style as CommitInfoPanel body */}
          {issue.body ? (
            <div className="min-h-0 overflow-y-auto scrollbar-hide">
              <p className="max-w-[860px] whitespace-pre-wrap text-[12px] leading-5 text-text-2">
                {issue.body}
              </p>
            </div>
          ) : null}

          {/* Close / Reopen inline action */}
          <div>
            {isOpen ? (
              <Button
                htmlType="button"
                variant="secondary"
                size="mini"
                onClick={onCloseIssue}
              >
                Close issue
              </Button>
            ) : (
              <Button
                htmlType="button"
                variant="secondary"
                size="mini"
                onClick={onReopenIssue}
              >
                Reopen issue
              </Button>
            )}
          </div>
        </div>

        {/* ── Comments — scrollable main area, mirrors diff viewer area ─────── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Section heading */}
          <div className="flex-shrink-0 border-b border-border-2 px-4 py-2">
            <span
              className={`${TYPOGRAPHY.badge} font-medium uppercase tracking-wider text-text-3`}
            >
              {commentsLoading ? "Comments" : `Comments (${comments.length})`}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
            {commentsLoading ? (
              <div className="flex items-center justify-center py-6 text-text-3">
                <Loader size={14} className="animate-spin" />
              </div>
            ) : comments.length === 0 ? (
              <div
                className={`px-4 py-3 ${TYPOGRAPHY.secondary} italic text-text-3`}
              >
                No comments yet
              </div>
            ) : (
              <div className="flex flex-col">
                {comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="flex gap-2.5 border-b border-border-2 px-4 py-3 last:border-b-0"
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
                      <p className="max-w-[860px] whitespace-pre-wrap text-[12px] leading-5 text-text-2">
                        {comment.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Comment composer — fixed footer ─────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-border-2 px-4 py-3">
          <Textarea
            value={commentBody}
            onChange={setCommentBody}
            placeholder={t("git.issues.commentPlaceholder", "Leave a comment…")}
            rows={3}
            size="mini"
            resize="none"
            className="mb-2 min-h-[60px]"
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
    );
  }
);

IssueDetailPanel.displayName = "IssueDetailPanel";
