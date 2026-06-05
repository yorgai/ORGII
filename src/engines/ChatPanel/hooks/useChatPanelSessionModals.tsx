import { emit } from "@tauri-apps/api/event";
import type { TFunction } from "i18next";
import { type ComponentProps, useCallback, useState } from "react";

import Message from "@src/components/Message";
import { SessionImportExportModal } from "@src/scaffold/NavigationSidebar/connectors/SessionImportExportModal";

import LinkSessionToWorkItemModal from "../LinkSessionToWorkItemModal";

type ExportActiveSession = ComponentProps<
  typeof SessionImportExportModal
>["activeSession"];

interface UseChatPanelSessionModalsOptions {
  activeSession: ExportActiveSession;
  closeHeaderActionsMenu: () => void;
  currentSessionId: string | null;
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
}

export function useChatPanelSessionModals({
  activeSession,
  closeHeaderActionsMenu,
  currentSessionId,
  t,
}: UseChatPanelSessionModalsOptions) {
  const [isExportModalOpen, setExportModalOpen] = useState(false);
  const [isLinkWorkItemModalOpen, setLinkWorkItemModalOpen] = useState(false);

  const handleOpenExportSessionJson = useCallback(() => {
    setExportModalOpen(true);
    closeHeaderActionsMenu();
  }, [closeHeaderActionsMenu]);

  const handleCloseExportSessionJson = useCallback(() => {
    setExportModalOpen(false);
  }, []);

  const handleOpenLinkWorkItem = useCallback(() => {
    if (!currentSessionId) {
      Message.warning("Open a session before linking a Work Item.");
      return;
    }
    setLinkWorkItemModalOpen(true);
    closeHeaderActionsMenu();
  }, [closeHeaderActionsMenu, currentSessionId]);

  const handleCloseLinkWorkItem = useCallback(() => {
    setLinkWorkItemModalOpen(false);
  }, []);

  const handleSessionLinkedToWorkItem = useCallback(() => {
    void emit("orgii-data-changed", new Date().toISOString());
  }, []);

  const sessionModals = (
    <>
      <LinkSessionToWorkItemModal
        open={isLinkWorkItemModalOpen}
        sessionId={currentSessionId ?? null}
        onClose={handleCloseLinkWorkItem}
        onLinked={handleSessionLinkedToWorkItem}
      />
      <SessionImportExportModal
        visible={isExportModalOpen}
        mode="export"
        activeSession={activeSession}
        sessionFallbackName={t("chat.defaultTitle")}
        onClose={handleCloseExportSessionJson}
        onImported={() => undefined}
      />
    </>
  );

  return {
    handleOpenExportSessionJson,
    handleOpenLinkWorkItem,
    sessionModals,
  };
}
