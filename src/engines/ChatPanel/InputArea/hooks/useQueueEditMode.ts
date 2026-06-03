/**
 * useQueueEditMode
 *
 * Shared hook for queue message editing in the main input box.
 * Reads/writes queueEditTargetAtom and returns props ready to spread onto InputArea.
 *
 * @param onCommit — called with (messageId, newContent, imageDataUrls) when the user submits.
 *                   Callers use this to persist the edit (atom write, local state, etc.).
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { queueEditTargetAtom } from "@src/store/ui/messageQueueAtom";

interface UseQueueEditModeOptions {
  onCommit: (
    messageId: string,
    content: string,
    imageDataUrls?: string[]
  ) => void;
  onCommitSendNow?: (messageId: string) => void;
}

export interface QueueEditInputAreaProps {
  isEditMode: boolean;
  initialContent: string | undefined;
  editImages: string[] | undefined;
  onEditSubmit: (text: string) => void;
  onEditSendNow?: (text: string) => void;
  onEditCancel: () => void;
  editLabel: string | undefined;
  showEditHeader: boolean;
}

export function useQueueEditMode({
  onCommit,
  onCommitSendNow,
}: UseQueueEditModeOptions): QueueEditInputAreaProps {
  const { t } = useTranslation("sessions");
  const queueEditTarget = useAtomValue(queueEditTargetAtom);
  const setQueueEditTarget = useSetAtom(queueEditTargetAtom);

  const commitEdit = useCallback(
    (text: string): string | null => {
      if (!queueEditTarget) return null;
      onCommit(queueEditTarget.messageId, text, queueEditTarget.imageDataUrls);
      return queueEditTarget.messageId;
    },
    [queueEditTarget, onCommit]
  );

  const onEditSubmit = useCallback(
    (text: string) => {
      commitEdit(text);
      setQueueEditTarget(null);
    },
    [commitEdit, setQueueEditTarget]
  );

  const onEditSendNow = useCallback(
    (text: string) => {
      const messageId = commitEdit(text);
      setQueueEditTarget(null);
      if (messageId) onCommitSendNow?.(messageId);
    },
    [commitEdit, onCommitSendNow, setQueueEditTarget]
  );

  const onEditCancel = useCallback(() => {
    setQueueEditTarget(null);
  }, [setQueueEditTarget]);

  return {
    isEditMode: !!queueEditTarget,
    initialContent: queueEditTarget?.content,
    editImages: queueEditTarget?.imageDataUrls,
    onEditSubmit,
    onEditSendNow,
    onEditCancel,
    editLabel: queueEditTarget ? t("input.editingQueuedMessage") : undefined,
    showEditHeader: false,
  };
}
