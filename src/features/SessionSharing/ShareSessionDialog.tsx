import { useSetAtom } from "jotai";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import Textarea from "@src/components/Textarea";
import Modal from "@src/scaffold/ModalSystem";

import {
  type HostSessionSharePublisher,
  startHostSessionShare,
} from "./hostPublisher";
import {
  type HostViewerMessageToast,
  createViewerMessageToast,
  hostViewerMessagesAtom,
} from "./state";

interface ShareSessionDialogProps {
  sessionId: string;
  onClose: () => void;
}

export const ShareSessionDialog: React.FC<ShareSessionDialogProps> = ({
  sessionId,
  onClose,
}) => {
  const { t } = useTranslation("sessions");
  const setHostViewerMessages = useSetAtom(hostViewerMessagesAtom);
  const [pin, setPin] = useState("");
  const [answerCode, setAnswerCode] = useState("");
  const [publisher, setPublisher] = useState<HostSessionSharePublisher | null>(
    null
  );
  const [viewerMessages, setViewerMessages] = useState<
    HostViewerMessageToast[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleStart = async () => {
    setError(null);
    setLoading(true);
    try {
      const nextPublisher = await startHostSessionShare({ sessionId, pin });
      nextPublisher.onViewerMessage((message) => {
        const toast = createViewerMessageToast(message);
        setViewerMessages((current) => [toast, ...current].slice(0, 5));
        setHostViewerMessages((current) => [toast, ...current].slice(0, 20));
      });
      setPublisher(nextPublisher);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptAnswer = async () => {
    if (!publisher) return;
    setError(null);
    setLoading(true);
    try {
      await publisher.acceptAnswer(answerCode.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    publisher?.stop();
    onClose();
  };

  const handleOk = async () => {
    if (publisher) {
      await handleAcceptAnswer();
      return;
    }
    await handleStart();
  };

  const okText = publisher
    ? t("sharing.acceptAnswer")
    : t("sharing.generateOffer");
  const okDisabled = publisher ? !answerCode.trim() : !pin.trim();

  return (
    <Modal
      visible
      title={t("sharing.shareDialogTitle")}
      onCancel={handleClose}
      onOk={handleOk}
      okText={okText}
      cancelText={t("common:actions.close")}
      okButtonProps={{ loading, disabled: okDisabled }}
      cancelButtonProps={{ disabled: loading }}
      width={640}
      bodyClassName="p-4"
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-text-2">
          {t("sharing.sharePrivacyWarning")}
        </p>

        <label className="block space-y-1.5 text-sm text-text-1">
          <span>{t("sharing.pinLabel")}</span>
          <Input
            value={pin}
            onChange={setPin}
            inputMode="numeric"
            autoFocus
            disabled={Boolean(publisher)}
          />
        </label>

        {publisher && (
          <div className="space-y-3">
            <label className="block space-y-1.5 text-sm text-text-1">
              <span>{t("sharing.offerCodeLabel")}</span>
              <Textarea
                readOnly
                resize="none"
                rows={4}
                value={publisher.offerCode}
              />
            </label>
            <label className="block space-y-1.5 text-sm text-text-1">
              <span>{t("sharing.answerCodeLabel")}</span>
              <Textarea
                resize="none"
                rows={3}
                value={answerCode}
                onChange={setAnswerCode}
              />
            </label>
          </div>
        )}

        {viewerMessages.length > 0 && (
          <div className="rounded-xl border border-border-2 bg-fill-1 px-3 py-2">
            <div className="mb-2 text-sm font-medium text-text-1">
              {t("sharing.viewerMessages")}
            </div>
            <div className="space-y-2">
              {viewerMessages.map((message) => (
                <div key={message.id} className="text-sm text-text-2">
                  <span className="font-medium text-text-1">
                    {message.viewerLabel || t("sharing.viewerLabel")}
                  </span>
                  {": "}
                  {message.text}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-danger-6">{error}</p>}
      </div>
    </Modal>
  );
};
