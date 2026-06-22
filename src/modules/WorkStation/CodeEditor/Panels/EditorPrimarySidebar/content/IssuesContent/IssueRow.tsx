import { CircleDot, MessageSquare, XCircle } from "lucide-react";
import React, { memo, useCallback, useMemo } from "react";

import type { GitHubIssue } from "@src/api/tauri/github";
import Tag from "@src/components/Tag";
import { TreeRowBase, type TreeRowNode } from "@src/components/TreeRow";
import { TYPOGRAPHY } from "@src/config/workstation/tokens";
import { getLabelColorStyle } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/hooks/workstationIssueHelpers";

interface IssueRowProps {
  issue: GitHubIssue;
  depth?: number;
  isSelected: boolean;
  onClick: () => void;
}

export const IssueRow: React.FC<IssueRowProps> = memo(
  ({ issue, depth = 0, isSelected, onClick }) => {
    const isOpen = issue.state === "open";

    const handleDragStart = useCallback(
      (event: React.DragEvent<HTMLElement>) => {
        const issuePayload = {
          issueNumber: issue.number,
          issueTitle: issue.title,
          issueUrl: issue.html_url,
          issueState: issue.state,
          labels: issue.labels.map((label) => label.name),
          assignees: issue.assignees.map((assignee) => assignee.login),
          comments: issue.comments,
        };
        event.dataTransfer.setData(
          "application/x-orgii-issue-reference",
          JSON.stringify(issuePayload)
        );
        window.__orgiiLastIssueDrag = {
          ...issuePayload,
          timestamp: Date.now(),
        };
        event.dataTransfer.effectAllowed = "copy";
      },
      [issue]
    );

    const treeRowNode: TreeRowNode = useMemo(
      () => ({
        id: String(issue.number),
        name: issue.title,
        path: issue.html_url,
        type: "file",
        icon: (
          <span className={isOpen ? "text-success-6" : "text-text-3"}>
            {isOpen ? (
              <CircleDot size={14} strokeWidth={1.75} />
            ) : (
              <XCircle size={14} strokeWidth={1.75} />
            )}
          </span>
        ),
      }),
      [isOpen, issue.html_url, issue.number, issue.title]
    );

    return (
      <TreeRowBase
        node={treeRowNode}
        depth={depth}
        isSelected={isSelected}
        onClick={onClick}
        showIndentGuides={false}
        draggable
        onDragStart={handleDragStart}
      >
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {issue.labels.slice(0, 2).map((label) => {
            const style = getLabelColorStyle(label.color);
            return (
              <Tag
                key={label.id}
                size="mini"
                pill
                className={`${TYPOGRAPHY.badge} !px-1 !py-[1px] !leading-tight`}
                style={style}
              >
                {label.name}
              </Tag>
            );
          })}

          {issue.comments > 0 && (
            <span
              className={`flex items-center gap-0.5 ${TYPOGRAPHY.secondary} text-text-3`}
            >
              <MessageSquare size={11} strokeWidth={1.75} />
              <span>{issue.comments}</span>
            </span>
          )}

          <span className="min-w-[28px] text-right text-[11px] tabular-nums text-text-3">
            #{issue.number}
          </span>
        </span>
      </TreeRowBase>
    );
  }
);

IssueRow.displayName = "IssueRow";
