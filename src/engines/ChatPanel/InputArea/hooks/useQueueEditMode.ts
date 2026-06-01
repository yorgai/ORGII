/**
 * useQueueEditMode
 *
 * Shared hook for Cursor-style queue message editing in the main input box.
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
}

export interface QueueEditInputAreaProps {
  isEditMode: boolean;
  initialContent: string | undefined;
  editImages: string[] | undefined;
  onEditSubmit: (text: string) => void;
  onEditCancel: () => void;
  editLabel: string | undefined;
}

export function useQueueEditMode({
  onCommit,
}: UseQueueEditModeOptions): QueueEditInputAreaProps {
  const { t } = useTranslation("sessions");
  const queueEditTarget = useAtomValue(queueEditTargetAtom);
  const setQueueEditTarget = useSetAtom(queueEditTargetAtom);

  const onEditSubmit = useCallback(
    (text: string) => {
      if (queueEditTarget) {
        onCommit(
          queueEditTarget.messageId,
          text,
          queueEditTarget.imageDataUrls
        );
      }
      setQueueEditTarget(null);
    },
    [queueEditTarget, onCommit, setQueueEditTarget]
  );

  const onEditCancel = useCallback(() => {
    setQueueEditTarget(null);
  }, [setQueueEditTarget]);

  return {
    isEditMode: !!queueEditTarget,
    initialContent: queueEditTarget?.content,
    editImages: queueEditTarget?.imageDataUrls,
    onEditSubmit,
    onEditCancel,
    editLabel: queueEditTarget ? t("input.editingQueuedMessage") : undefined,
  };
}
