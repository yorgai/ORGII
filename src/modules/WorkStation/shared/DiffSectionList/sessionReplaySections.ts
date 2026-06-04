import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  extractEditData,
  parseUnifiedDiffToOldNew,
} from "@src/engines/SessionCore/rendering/props/propsDataExtractors";
import { normalizeEventProps } from "@src/engines/SessionCore/rendering/props/propsNormalizer";

import type { DiffFileSectionData } from "../DiffFileSection";
import type { DiffSectionListItem } from "./index";

export interface SessionReplayDiffEntryLike {
  entryId: string;
  event: SessionEvent;
  filePath: string;
  fileName: string;
}

export interface SessionReplayDiffSectionItem extends DiffSectionListItem<DiffFileSectionData> {
  entryIds: string[];
}

function getDiffStatus(
  entry: SessionReplayDiffEntryLike,
  isDeleted: boolean | undefined,
  oldContent: string | undefined,
  newContent: string | undefined
): DiffFileSectionData["status"] {
  const action =
    typeof entry.event.args?.action === "string" ? entry.event.args.action : "";
  const functionName = entry.event.functionName || "";
  if (
    isDeleted ||
    action.includes("delete") ||
    functionName.includes("delete")
  ) {
    return "deleted";
  }
  if (action.includes("create") || (!oldContent && Boolean(newContent))) {
    return "added";
  }
  return "modified";
}

export function buildSessionReplayDiffSectionItems(
  entry: SessionReplayDiffEntryLike
): SessionReplayDiffSectionItem[] {
  const universal = normalizeEventProps({ event: entry.event }, "tool_call");
  if (!universal) return [];

  const editData = extractEditData(universal);
  const segments =
    editData.applyPatchSegments && editData.applyPatchSegments.length > 0
      ? editData.applyPatchSegments
      : [editData];

  return segments.map((segment, index) => {
    const parsed =
      segment.diff &&
      (segment.oldContent === undefined || segment.newContent === undefined)
        ? parseUnifiedDiffToOldNew(segment.diff)
        : undefined;
    const isDeleted = segment.isDeleted;
    const oldContent = isDeleted
      ? (segment.oldContent ?? parsed?.oldValue ?? segment.content ?? "")
      : (segment.oldContent ?? parsed?.oldValue ?? "");
    const newContent = isDeleted
      ? ""
      : (segment.newContent ?? parsed?.newValue ?? segment.content ?? "");
    const path = segment.filePath || entry.filePath || entry.fileName;

    return {
      key: `${entry.entryId}:${index}:${path}`,
      file: {
        path,
        status: getDiffStatus(entry, isDeleted, oldContent, newContent),
        staged: false,
        additions: segment.linesAdded,
        deletions: segment.linesRemoved,
        oldContent,
        newContent,
      },
      entryIds: [entry.entryId],
    };
  });
}

function mergeStatus(
  previous: DiffFileSectionData["status"],
  next: DiffFileSectionData["status"]
): DiffFileSectionData["status"] {
  if (next === "deleted") return "deleted";
  if (previous === "added" || next === "added") return "added";
  return "modified";
}

export function buildConsolidatedSessionReplayDiffSectionItems<
  TEntry extends SessionReplayDiffEntryLike,
>(entries: TEntry[]): SessionReplayDiffSectionItem[] {
  const byPath = new Map<string, SessionReplayDiffSectionItem>();

  for (const entry of entries) {
    for (const section of buildSessionReplayDiffSectionItems(entry)) {
      const path = section.file.path;
      const existing = byPath.get(path);
      if (!existing) {
        byPath.set(path, {
          key: path,
          file: { ...section.file },
          entryIds: [...section.entryIds],
        });
        continue;
      }

      existing.file = {
        ...existing.file,
        status: mergeStatus(existing.file.status, section.file.status),
        additions:
          existing.file.additions !== undefined ||
          section.file.additions !== undefined
            ? (existing.file.additions ?? 0) + (section.file.additions ?? 0)
            : undefined,
        deletions:
          existing.file.deletions !== undefined ||
          section.file.deletions !== undefined
            ? (existing.file.deletions ?? 0) + (section.file.deletions ?? 0)
            : undefined,
        oldContent: existing.file.oldContent,
        newContent: section.file.newContent,
      };
      existing.entryIds.push(...section.entryIds);
    }
  }

  return Array.from(byPath.values());
}
