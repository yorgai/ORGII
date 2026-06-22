/**
 * useDragDrop
 *
 * Handles drag and drop for the InputArea
 */
import { type DragEvent, type RefObject, useCallback } from "react";

import type { ComposerInputRef } from "@src/components/ComposerInput";
import Message from "@src/components/Message";
import { capPillText, storePillText } from "@src/config/pillTokens";
import i18n from "@src/i18n";

import type { DragDropHandlers } from "./types";

// Drag-over visual feedback — applied/removed via inline style
// so no SCSS file is needed. Inline styles beat class-based rules,
// making !important unnecessary.
function applyDragOverStyle(element: HTMLElement): void {
  element.style.border = "2px dashed var(--color-primary-6)";
  element.style.marginTop = "10px";
  element.style.borderRadius = "12px";
  element.style.backgroundColor =
    "color-mix(in srgb, var(--color-primary-6) 5%, transparent)";
}

function removeDragOverStyle(element: HTMLElement): void {
  element.style.border = "";
  element.style.marginTop = "";
  element.style.borderRadius = "";
  element.style.backgroundColor = "";
}

interface UseDragDropOptions {
  composerInputRef: RefObject<ComposerInputRef | null>;
}

type PrReferencePayload = {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  prStatus: string;
  sourceBranch?: string;
  targetBranch?: string;
  additions?: number;
  deletions?: number;
};

type IssueReferencePayload = {
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  issueState: string;
  labels?: string[];
  assignees?: string[];
  comments?: number;
};

function getDragReferenceData(
  dataTransfer: DataTransfer,
  type: "pr" | "issue"
): string {
  const mimeType =
    type === "pr"
      ? "application/x-orgii-pr-reference"
      : "application/x-orgii-issue-reference";
  const data = dataTransfer.getData(mimeType);
  if (data) return data;

  if (type === "pr") {
    const stash = window.__orgiiLastPrDrag;
    return stash && Date.now() - stash.timestamp < 30_000
      ? JSON.stringify(stash)
      : "";
  }

  const stash = window.__orgiiLastIssueDrag;
  return stash && Date.now() - stash.timestamp < 30_000
    ? JSON.stringify(stash)
    : "";
}

function insertPrReferencePill(
  composerInputRef: RefObject<ComposerInputRef | null>,
  payload: PrReferencePayload
): void {
  if (!composerInputRef.current) return;
  const pillPath = `pr://${payload.prNumber}`;
  const displayName = `#${payload.prNumber} ${payload.prTitle}`;
  storePillText(pillPath, capPillText(JSON.stringify(payload)));
  composerInputRef.current.insertFilePill(pillPath, false, "pr", displayName);
  Message.success(i18n.t("toasts.addedAsContext", { name: displayName }));
}

function insertIssueReferencePill(
  composerInputRef: RefObject<ComposerInputRef | null>,
  payload: IssueReferencePayload
): void {
  if (!composerInputRef.current) return;
  const pillPath = `issue://${payload.issueNumber}`;
  const displayName = `#${payload.issueNumber} ${payload.issueTitle}`;
  storePillText(pillPath, capPillText(JSON.stringify(payload)));
  composerInputRef.current.insertFilePill(
    pillPath,
    false,
    "issue",
    displayName
  );
  Message.success(i18n.t("toasts.addedAsContext", { name: displayName }));
}

export function useDragDrop(options: UseDragDropOptions): DragDropHandlers {
  const { composerInputRef } = options;

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    const dragWindow = window as unknown as {
      __internalFileTreeDrag?: boolean;
      __orgiiLastPrDrag?: { timestamp: number };
      __orgiiLastIssueDrag?: { timestamp: number };
    };
    const now = Date.now();
    const isInternalFileDrag = dragWindow.__internalFileTreeDrag === true;
    const isReferenceDrag =
      Boolean(
        dragWindow.__orgiiLastPrDrag &&
        now - dragWindow.__orgiiLastPrDrag.timestamp < 30_000
      ) ||
      Boolean(
        dragWindow.__orgiiLastIssueDrag &&
        now - dragWindow.__orgiiLastIssueDrag.timestamp < 30_000
      );

    // Only handle internal file/reference drags - let others bubble to GlobalDragDrop
    if (!isInternalFileDrag && !isReferenceDrag) {
      return;
    }

    // Stop propagation to prevent GlobalDragDrop from handling it
    e.preventDefault();
    e.stopPropagation();
    if (
      e.nativeEvent &&
      typeof (e.nativeEvent as Event).stopImmediatePropagation === "function"
    ) {
      (e.nativeEvent as Event).stopImmediatePropagation();
    }

    // Add visual feedback
    applyDragOverStyle(e.currentTarget);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    const dragWindow = window as unknown as {
      __internalFileTreeDrag?: boolean;
      __orgiiLastPrDrag?: { timestamp: number };
      __orgiiLastIssueDrag?: { timestamp: number };
    };
    const now = Date.now();
    const isInternalFileDrag = dragWindow.__internalFileTreeDrag === true;
    const isReferenceDrag =
      Boolean(
        dragWindow.__orgiiLastPrDrag &&
        now - dragWindow.__orgiiLastPrDrag.timestamp < 30_000
      ) ||
      Boolean(
        dragWindow.__orgiiLastIssueDrag &&
        now - dragWindow.__orgiiLastIssueDrag.timestamp < 30_000
      );

    if (!isInternalFileDrag && !isReferenceDrag) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    removeDragOverStyle(e.currentTarget);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const types = Array.from(e.dataTransfer.types);
      const isInternalFileDrag = types.includes("application/x-file-reference");
      const prReferenceData = getDragReferenceData(e.dataTransfer, "pr");
      const issueReferenceData = getDragReferenceData(e.dataTransfer, "issue");
      const isReferenceDrag = Boolean(prReferenceData || issueReferenceData);

      // Only handle internal file/reference drags - let others bubble to GlobalDragDrop
      if (!isInternalFileDrag && !isReferenceDrag) {
        return;
      }

      // Stop propagation to prevent GlobalDragDrop from handling it
      e.preventDefault();
      e.stopPropagation();
      if (
        e.nativeEvent &&
        typeof (e.nativeEvent as Event).stopImmediatePropagation === "function"
      ) {
        (e.nativeEvent as Event).stopImmediatePropagation();
      }
      removeDragOverStyle(e.currentTarget);

      if (prReferenceData || issueReferenceData) {
        const type = prReferenceData ? "pr" : "issue";
        const rawData = prReferenceData || issueReferenceData;
        try {
          const rawPayload = JSON.parse(rawData) as Record<string, unknown>;
          if (type === "pr") {
            const payload: PrReferencePayload = {
              prNumber: Number(rawPayload.prNumber),
              prTitle: String(rawPayload.prTitle ?? ""),
              prUrl: String(rawPayload.prUrl ?? ""),
              prStatus: String(rawPayload.prStatus ?? ""),
              sourceBranch:
                typeof rawPayload.sourceBranch === "string"
                  ? rawPayload.sourceBranch
                  : undefined,
              targetBranch:
                typeof rawPayload.targetBranch === "string"
                  ? rawPayload.targetBranch
                  : undefined,
              additions:
                typeof rawPayload.additions === "number"
                  ? rawPayload.additions
                  : undefined,
              deletions:
                typeof rawPayload.deletions === "number"
                  ? rawPayload.deletions
                  : undefined,
            };
            if (payload.prNumber && payload.prTitle) {
              insertPrReferencePill(composerInputRef, payload);
            }
          } else {
            const payload: IssueReferencePayload = {
              issueNumber: Number(rawPayload.issueNumber),
              issueTitle: String(rawPayload.issueTitle ?? ""),
              issueUrl: String(rawPayload.issueUrl ?? ""),
              issueState: String(rawPayload.issueState ?? ""),
              labels: Array.isArray(rawPayload.labels)
                ? rawPayload.labels.map(String)
                : undefined,
              assignees: Array.isArray(rawPayload.assignees)
                ? rawPayload.assignees.map(String)
                : undefined,
              comments:
                typeof rawPayload.comments === "number"
                  ? rawPayload.comments
                  : undefined,
            };
            if (payload.issueNumber && payload.issueTitle) {
              insertIssueReferencePill(composerInputRef, payload);
            }
          }
        } catch {
          // Malformed drag payload: ignore.
        } finally {
          if (type === "pr") {
            window.__orgiiLastPrDrag = undefined;
          } else {
            window.__orgiiLastIssueDrag = undefined;
          }
        }
        return;
      }

      // Get file reference data
      const fileReferenceData = e.dataTransfer.getData(
        "application/x-file-reference"
      );

      if (!fileReferenceData) {
        return;
      }

      let fileRef: { path: string; name: string; type: string };
      try {
        fileRef = JSON.parse(fileReferenceData);
      } catch (_parseError) {
        return;
      }

      if (!fileRef.path) {
        return;
      }

      // Insert file pill
      if (!composerInputRef.current) {
        return;
      }

      const isFolder = fileRef.type === "directory";
      composerInputRef.current.insertFilePill(
        fileRef.path,
        isFolder,
        isFolder ? "folder" : "file"
      );
      Message.success(i18n.t("toasts.addedAsContext", { name: fileRef.name }));
    },
    [composerInputRef]
  );

  return {
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
