import React from "react";

import { getToolIcon } from "@src/config/toolIcons";
import { resolveToolName } from "@src/engines/SessionCore/rendering/registry/toolAliases";

import { resolveFileOperationPayload } from "../resolveFilePayload";
import { FILE_OPERATION_TYPE, type FileOperationEntry } from "../types";

export const SIDEBAR_ICON_PROPS = {
  size: 14,
  className: "shrink-0 text-text-3",
} as const;

export function getWriteStatusBadge(op: FileOperationEntry): {
  label: string;
  colorClass: string;
} | null {
  if (op.type === FILE_OPERATION_TYPE.DELETE) {
    return { label: "D", colorClass: "text-danger-6" };
  }
  if (op.type !== FILE_OPERATION_TYPE.WRITE) return null;
  const hasBaseline =
    op.writeHasBaselineContent !== undefined
      ? op.writeHasBaselineContent
      : Boolean(resolveFileOperationPayload(op).oldContent);
  return hasBaseline
    ? { label: "M", colorClass: "text-warning-6" }
    : { label: "A", colorClass: "text-success-6" };
}

export function sidebarToolIcon(functionName?: string): React.ReactNode {
  return getToolIcon(resolveToolName(functionName ?? ""), SIDEBAR_ICON_PROPS);
}
