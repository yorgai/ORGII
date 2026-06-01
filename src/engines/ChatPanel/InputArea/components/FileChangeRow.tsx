/**
 * FileChangeRow
 *
 * A single row in the CompactFileChanges list. Renders the file icon,
 * name, diff stats (+N / -N), and per-file Accept/Reject action buttons
 * that appear on hover while the session has pending snapshots.
 */
import { Check, X } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import FileTypeIcon from "@src/components/FileTypeIcon";
import {
  COMPOSER_STACK_ROW_BASE,
  COMPOSER_STACK_ROW_HOVER,
  COMPOSER_STACK_ROW_LABEL,
} from "@src/config/composerStackTokens";

import type { FileChangeInfo } from "./compactFileChangesHelpers";

export interface FileChangeRowProps {
  file: FileChangeInfo;
  hasPendingActions: boolean;
  batchActionsDisabled: boolean;
  onFileClick: (filePath: string) => void;
  onFileReject: (filePath: string) => Promise<void>;
  onFileAccept: (filePath: string) => void;
}

const FileChangeRow = memo(
  ({
    file,
    hasPendingActions,
    batchActionsDisabled,
    onFileClick,
    onFileReject,
    onFileAccept,
  }: FileChangeRowProps) => {
    const { t } = useTranslation();

    return (
      <div
        key={file.path}
        title={file.path}
        className={`group ${COMPOSER_STACK_ROW_BASE} ${COMPOSER_STACK_ROW_HOVER}`}
      >
        <FileTypeIcon fileName={file.fileName} size="small" />
        <button
          onClick={() => onFileClick(file.path)}
          className={`${COMPOSER_STACK_ROW_LABEL} !flex-initial shrink cursor-pointer border-0 bg-transparent p-0 text-left transition-colors group-hover:text-text-1`}
        >
          {file.fileName}
        </button>

        {(file.additions > 0 || file.deletions > 0) && (
          <span
            className={`chat-block-xs flex shrink-0 items-center gap-1 ${
              hasPendingActions ? "group-hover:hidden" : ""
            }`}
          >
            {file.additions > 0 && (
              <span className="text-green-500">+{file.additions}</span>
            )}
            {file.deletions > 0 && (
              <span className="text-red-500">-{file.deletions}</span>
            )}
          </span>
        )}

        <span className="flex-1" />

        {hasPendingActions && (
          <span className="hidden items-center gap-0.5 group-hover:flex">
            <Button
              variant="tertiary"
              size="mini"
              icon={<X size={11} />}
              onClick={() => onFileReject(file.path)}
              disabled={batchActionsDisabled}
              title={t("actions.reject")}
            />
            <Button
              variant="tertiary"
              size="mini"
              icon={<Check size={11} />}
              onClick={() => onFileAccept(file.path)}
              disabled={batchActionsDisabled}
              title={t("actions.accept")}
            />
          </span>
        )}
      </div>
    );
  }
);

FileChangeRow.displayName = "FileChangeRow";

export default FileChangeRow;
