/**
 * GlobalDragDrop Component
 *
 * Global drag-and-drop handler. Behavior is derived from the drop target:
 * - Drop files onto a visible composer input → add as chat context.
 * - Drop a folder on the Start page → offer to add as a repository.
 */
import { Folder } from "lucide-react";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";

import "./index.scss";
import { useGlobalDragDrop } from "./useGlobalDragDrop/index";

const GlobalDragDrop: React.FC = () => {
  const { t } = useTranslation();
  const {
    isDragging,
    behavior,
    droppedFolder,
    handleOpenSpotlight,
    setDroppedFolder,
    getContainerStyle,
  } = useGlobalDragDrop();

  const showRepositoryHint = isDragging && behavior?.mode === "repository";
  const isChatFileDragging = isDragging && behavior?.mode === "chat-file";

  useEffect(() => {
    document.body.dataset.chatFileDragging = isChatFileDragging
      ? "true"
      : "false";
    return () => {
      delete document.body.dataset.chatFileDragging;
    };
  }, [isChatFileDragging]);

  return (
    <>
      {showRepositoryHint && behavior && (
        <div style={getContainerStyle(behavior.location)}>
          <div className="global-drag-drop__repository-hint">
            <Folder size={64} strokeWidth={1.5} />
            <div className="global-drag-drop__title">
              {t("dragDrop.dropFolderToAdd")}
            </div>
            <div className="global-drag-drop__description">
              {t("dragDrop.releaseToOpenFolder")}
            </div>
          </div>
        </div>
      )}

      {droppedFolder && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-bg-overlay">
          <div className="flex flex-col items-center gap-4 rounded-lg bg-bg-2 p-6 shadow-lg">
            <div className="text-[16px] font-medium text-text-1">
              {t("dragDrop.folderDetected")}
            </div>
            <div className="text-[14px] text-text-2">{droppedFolder.name}</div>
            <div className="mb-2 text-[12px] text-text-3">
              {t("dragDrop.openSpotlightToAdd")}
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleOpenSpotlight}
                className="rounded-lg bg-primary-6 px-4 py-2 text-[14px] text-text-white hover:bg-primary-7"
              >
                {t("dragDrop.openSpotlight")}
              </button>
              <button
                onClick={() => setDroppedFolder(null)}
                className="rounded-lg border border-border-2 bg-bg-2 px-4 py-2 text-[14px] text-text-1 hover:bg-bg-3"
              >
                {t("actions.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default GlobalDragDrop;
