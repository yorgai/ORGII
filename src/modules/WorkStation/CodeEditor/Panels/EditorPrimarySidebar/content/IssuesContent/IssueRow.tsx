import { CircleDot, MessageSquare, XCircle } from "lucide-react";
import React, { memo, useCallback, useMemo, useRef, useState } from "react";

import type { GitHubIssue } from "@src/api/tauri/github";
import IssueHoverCard from "@src/components/IssueHoverCard";
import Tag from "@src/components/Tag";
import { TreeRowBase, type TreeRowNode } from "@src/components/TreeRow";
import { TYPOGRAPHY } from "@src/config/workstation/tokens";
import {
  ReferenceDragGhost,
  type ReferenceDragState,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/components/ReferenceDragGhost";
import { getLabelColorStyle } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/hooks/workstationIssueHelpers";
import type { TabDragPillPayload } from "@src/modules/WorkStation/shared/TabBar/tabDragTypes";

const DRAG_THRESHOLD_PX = 6;

interface IssueRowProps {
  issue: GitHubIssue;
  depth?: number;
  isSelected: boolean;
  onClick: () => void;
}

export const IssueRow: React.FC<IssueRowProps> = memo(
  ({ issue, depth = 0, isSelected, onClick }) => {
    const isOpen = issue.state === "open";
    const pointerDragRef = useRef<{
      active: boolean;
      startX: number;
      startY: number;
      thresholdMet: boolean;
    } | null>(null);
    const [dragState, setDragState] = useState<ReferenceDragState | null>(null);

    const buildIssuePayload = useCallback(
      () => ({
        issueNumber: issue.number,
        issueTitle: issue.title,
        issueUrl: issue.html_url,
        issueState: issue.state,
        labels: issue.labels.map((label) => label.name),
        assignees: issue.assignees.map((assignee) => assignee.login),
        comments: issue.comments,
      }),
      [issue]
    );

    const buildIssuePillPayload = useCallback((): TabDragPillPayload => {
      const issuePayload = buildIssuePayload();
      return {
        path: `issue://${issuePayload.issueNumber}`,
        name: `#${issuePayload.issueNumber} ${issuePayload.issueTitle}`,
        iconType: "issue",
        isFolder: false,
        contextText: JSON.stringify(issuePayload),
      };
    }, [buildIssuePayload]);

    const stashIssueDrag = useCallback(() => {
      window.__orgiiLastIssueDrag = {
        ...buildIssuePayload(),
        timestamp: Date.now(),
      };
    }, [buildIssuePayload]);

    const handlePointerDown = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        stashIssueDrag();
        pointerDragRef.current = {
          active: true,
          startX: event.clientX,
          startY: event.clientY,
          thresholdMet: false,
        };

        const onPointerMove = (moveEvent: PointerEvent) => {
          const state = pointerDragRef.current;
          if (!state?.active) return;

          if (!state.thresholdMet) {
            const dx = moveEvent.clientX - state.startX;
            const dy = moveEvent.clientY - state.startY;
            if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD_PX) return;

            state.thresholdMet = true;
            const pill = buildIssuePillPayload();
            window.__internalWorkstationTabDrag = true;
            window.__internalWorkstationTabDragData = JSON.stringify(pill);
            document.dispatchEvent(
              new CustomEvent("tab-drag-start", {
                detail: { tabId: `issue-${issue.number}`, pill },
              })
            );
            setDragState({
              isDragging: true,
              dragX: moveEvent.clientX,
              dragY: moveEvent.clientY,
              dragLabel: pill.name ?? pill.path,
            });
          } else {
            setDragState((prev) =>
              prev
                ? {
                    ...prev,
                    dragX: moveEvent.clientX,
                    dragY: moveEvent.clientY,
                  }
                : null
            );
          }
        };

        const onPointerUp = (upEvent: PointerEvent) => {
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          window.removeEventListener("pointercancel", onPointerUp);

          const state = pointerDragRef.current;
          pointerDragRef.current = null;
          setDragState(null);
          window.__internalWorkstationTabDrag = false;
          window.__internalWorkstationTabDragData = undefined;

          if (state?.thresholdMet) {
            document.dispatchEvent(
              new CustomEvent("tab-drag-end", {
                detail: {
                  tabId: `issue-${issue.number}`,
                  pill: buildIssuePillPayload(),
                  pointerX: upEvent.clientX,
                  pointerY: upEvent.clientY,
                },
              })
            );
          }
        };

        window.addEventListener("pointermove", onPointerMove, {
          passive: true,
        });
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
      },
      [buildIssuePillPayload, issue.number, stashIssueDrag]
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
      <>
        {dragState && <ReferenceDragGhost dragState={dragState} />}
        <IssueHoverCard issue={issue}>
          <TreeRowBase
            node={treeRowNode}
            depth={depth}
            isSelected={isSelected}
            onClick={onClick}
            showIndentGuides={false}
            onMouseDown={stashIssueDrag}
            onPointerDown={handlePointerDown}
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
        </IssueHoverCard>
      </>
    );
  }
);

IssueRow.displayName = "IssueRow";
