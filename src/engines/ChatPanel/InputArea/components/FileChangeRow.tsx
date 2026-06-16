/**
 * FileChangeRow
 *
 * A single row in a compact file-changes list. Renders the file icon,
 * name, and diff stats (+N / -N). Read-only — the accept/reject controls
 * the composer card used to carry were dropped when the live snapshot
 * surface was removed; this row now only displays change metadata (e.g.
 * the per-round file list at the bottom of each chat turn).
 */
import { memo } from "react";

import FileTypeIcon from "@src/components/FileTypeIcon";
import {
  COMPOSER_STACK_ROW_BASE,
  COMPOSER_STACK_ROW_HOVER,
  COMPOSER_STACK_ROW_LABEL,
} from "@src/config/composerStackTokens";

import type { FileChangeInfo } from "./compactFileChangesHelpers";

export interface FileChangeRowProps {
  file: FileChangeInfo;
  /** Optional click handler — when provided the filename becomes a button. */
  onFileClick?: (filePath: string) => void;
}

const FileChangeRow = memo(({ file, onFileClick }: FileChangeRowProps) => {
  const stats = (file.additions > 0 || file.deletions > 0) && (
    <span className="chat-block-xs flex shrink-0 items-center gap-1">
      {file.additions > 0 && (
        <span className="text-green-500">+{file.additions}</span>
      )}
      {file.deletions > 0 && (
        <span className="text-red-500">-{file.deletions}</span>
      )}
    </span>
  );

  return (
    <div
      key={file.path}
      title={file.path}
      className={`group ${COMPOSER_STACK_ROW_BASE} ${
        onFileClick ? `${COMPOSER_STACK_ROW_HOVER} cursor-pointer` : ""
      }`}
      onClick={onFileClick ? () => onFileClick(file.path) : undefined}
    >
      <FileTypeIcon fileName={file.fileName} size="small" />
      <span
        className={`${COMPOSER_STACK_ROW_LABEL} ${
          onFileClick ? "group-hover:text-text-1" : ""
        }`}
      >
        {file.fileName}
      </span>

      {stats}
    </div>
  );
});

FileChangeRow.displayName = "FileChangeRow";

export default FileChangeRow;
