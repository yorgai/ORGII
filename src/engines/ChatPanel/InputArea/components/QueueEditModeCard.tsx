import { useAtomValue } from "jotai";
import React from "react";
import { useTranslation } from "react-i18next";

import { ChatStatusSegmentedBar } from "@src/engines/ChatPanel/components/ChatStatusBanners";
import { queueEditTargetAtom } from "@src/store/ui/messageQueueAtom";

const QueueEditModeCard: React.FC = () => {
  const { t } = useTranslation("sessions");
  const queueEditTarget = useAtomValue(queueEditTargetAtom);

  if (!queueEditTarget) return null;

  return (
    <ChatStatusSegmentedBar
      testId="queue-edit-mode-card"
      data-edit-message-id={queueEditTarget.messageId}
      segments={[
        {
          key: "label",
          className: "flex-1",
          content: (
            <span className="truncate font-medium">
              {t("input.editingQueuedMessage")}
            </span>
          ),
        },
      ]}
    />
  );
};

QueueEditModeCard.displayName = "QueueEditModeCard";

export default QueueEditModeCard;
