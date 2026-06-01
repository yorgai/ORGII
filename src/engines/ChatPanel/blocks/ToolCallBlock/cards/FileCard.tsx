import { ExternalLink } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import FileTypeIcon from "@src/components/FileTypeIcon";
import { openFileInEditor } from "@src/util/ui/openFileInEditor";

import type { FileCardData } from "../types";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileCardProps {
  card: FileCardData;
}

const FileCard: React.FC<FileCardProps> = ({ card }) => {
  const { t } = useTranslation("sessions");

  function handleOpen() {
    openFileInEditor(card.path);
  }

  return (
    <div className="mx-3 my-2 flex items-center gap-3 rounded-lg border border-fill-4 bg-fill-2 px-3 py-2.5 transition-colors hover:bg-fill-3">
      <div className="shrink-0">
        <FileTypeIcon fileName={card.name} size="medium" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="chat-block-content truncate font-medium text-text-1">
          {card.name}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-text-4">
          <span className="chat-block-content truncate text-xs">
            {card.path}
          </span>
          {card.sizeBytes !== undefined && (
            <>
              <span className="shrink-0 text-xs">·</span>
              <span className="shrink-0 text-xs">
                {formatFileSize(card.sizeBytes)}
              </span>
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={handleOpen}
        className="shrink-0 rounded p-1 text-text-4 transition-colors hover:bg-fill-4 hover:text-text-2"
        title={t("cards.openFile")}
      >
        <ExternalLink size={13} />
      </button>
    </div>
  );
};

FileCard.displayName = "FileCard";

export default FileCard;
