/**
 * Renderer for `github-issue-detail` tabs.
 *
 * Reads the selected issue from `workstationSelectedIssueAtom` and action
 * callbacks from `workstationIssueCallbackAtom`, then delegates to the
 * existing `IssueDetailPanel` component.
 */
import { useAtomValue } from "jotai";
import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useWorkStationTabs } from "@src/hooks/workStation/tabs/useWorkStationTabs";
import { IssueDetailPanel } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/IssuesContent/IssueDetailPanel";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import {
  workstationIssueCallbackAtom,
  workstationSelectedIssueAtom,
} from "@src/store/workstation/codeEditor/workstationIssueAtom";

import type { UnifiedTabContentProps } from "../types";

const GitHubIssueDetailTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => {
    const { t } = useTranslation();
    const selectedState = useAtomValue(workstationSelectedIssueAtom);
    const callbacks = useAtomValue(workstationIssueCallbackAtom);
    const { closeTab } = useWorkStationTabs();

    const handleClose = useCallback(() => {
      closeTab(tab.id);
    }, [closeTab, tab.id]);

    const handleCloseIssue = useCallback(() => {
      if (selectedState.issue && callbacks.closeIssue) {
        void callbacks.closeIssue(selectedState.issue.number);
      }
    }, [selectedState.issue, callbacks]);

    const handleReopenIssue = useCallback(() => {
      if (selectedState.issue && callbacks.reopenIssue) {
        void callbacks.reopenIssue(selectedState.issue.number);
      }
    }, [selectedState.issue, callbacks]);

    const handleAddComment = useCallback(
      async (body: string) => {
        if (selectedState.issue && callbacks.addComment) {
          await callbacks.addComment(selectedState.issue.number, body);
        }
      },
      [selectedState.issue, callbacks]
    );

    if (!selectedState.issue) {
      return (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("previews.noIssueSelected")}
          subtitle={t("previews.selectIssueHint")}
        />
      );
    }

    return (
      <IssueDetailPanel
        issue={selectedState.issue}
        comments={selectedState.comments}
        commentsLoading={selectedState.commentsLoading}
        submittingComment={selectedState.submittingComment}
        onClose={handleClose}
        onCloseIssue={handleCloseIssue}
        onReopenIssue={handleReopenIssue}
        onAddComment={handleAddComment}
      />
    );
  }
);

GitHubIssueDetailTabRenderer.displayName = "GitHubIssueDetailTabRenderer";

export default GitHubIssueDetailTabRenderer;
