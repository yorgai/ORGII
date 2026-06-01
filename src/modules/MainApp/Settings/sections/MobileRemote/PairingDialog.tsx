/**
 * PairingDialog
 *
 * Wizard dialog that walks the user through pairing a new mobile
 * device. Three visible phases inside the dialog body:
 *
 *   1. Form (tier picker + label) before pairing starts.
 *   2. QR + SAS phrase while waiting for the mobile side to claim.
 *   3. Success / error confirmation panels.
 *
 * The dialog itself owns the form state; the polling state machine
 * lives in `usePairingFlow`. We hand the hook `enabled = visible`
 * so all side effects stop when the dialog closes (per workspace rule
 * "Hooks with enabled flag must gate ALL side effects").
 */
import { CheckCircle2, Loader2, ShieldAlert, Smartphone } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  PERMISSION_TIER,
  type PairedDeviceInfo,
  type PermissionTier,
} from "@src/api/tauri/mobileRemote";
import InlineAlert from "@src/components/InlineAlert";
import Input from "@src/components/Input";
import Radio from "@src/components/Radio";
import Modal from "@src/scaffold/ModalSystem";

import QrCanvas from "./QrCanvas";
import SasPhraseDisplay from "./SasPhraseDisplay";
import usePairingFlow from "./usePairingFlow";

interface PairingDialogProps {
  visible: boolean;
  onClose: () => void;
  knownDevices: PairedDeviceInfo[];
  onPaired?: (device: PairedDeviceInfo) => void;
}

const DEFAULT_LABEL = "iPhone";

const PairingDialog: React.FC<PairingDialogProps> = ({
  visible,
  onClose,
  knownDevices,
  onPaired,
}) => {
  const { t } = useTranslation("settings");

  const [tier, setTier] = useState<PermissionTier>(PERMISSION_TIER.READ_ONLY);
  const [label, setLabel] = useState<string>(DEFAULT_LABEL);
  const [isPrimary] = useState<boolean>(false);

  const knownIdsSet = useMemo(
    () => new Set(knownDevices.map((dev) => dev.deviceId)),
    [knownDevices]
  );

  const handlePaired = useCallback(
    (device: PairedDeviceInfo) => {
      onPaired?.(device);
    },
    [onPaired]
  );

  const { state, start, cancel, reset } = usePairingFlow({
    enabled: visible,
    tier,
    label,
    isPrimary,
    knownDeviceIds: knownIdsSet,
    onSuccess: handlePaired,
  });

  // Reset when the dialog is closed externally so a re-open starts fresh.
  useEffect(() => {
    if (!visible) {
      reset();
    }
  }, [visible, reset]);

  const handleClose = useCallback(() => {
    if (state.stage === "awaitingMobile" || state.stage === "initializing") {
      cancel();
    }
    onClose();
  }, [state.stage, cancel, onClose]);

  const handleStart = useCallback(() => {
    start();
  }, [start]);

  const handleSuccessClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const renderForm = () => (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-text-2">
          {t("mobileRemote.tierPicker.label")}
        </label>
        <Radio.Group
          value={tier}
          onChange={(value) => setTier(value as PermissionTier)}
        >
          <div className="flex flex-col gap-3">
            <Radio value={PERMISSION_TIER.READ_ONLY}>
              <div className="flex flex-col">
                <span className="text-sm text-text-1">
                  {t("mobileRemote.tier.readOnly")}
                </span>
                <span className="text-xs text-text-3">
                  {t("mobileRemote.tierPicker.readOnlyDescription")}
                </span>
              </div>
            </Radio>
            <Radio value={PERMISSION_TIER.FULL}>
              <div className="flex flex-col">
                <span className="text-sm text-text-1">
                  {t("mobileRemote.tier.fullControl")}
                </span>
                <span className="text-xs text-text-3">
                  {t("mobileRemote.tierPicker.fullControlDescription")}
                </span>
              </div>
            </Radio>
          </div>
        </Radio.Group>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-text-2">
          {t("mobileRemote.labelInput.placeholder")}
        </label>
        <Input
          value={label}
          onChange={(value) => setLabel(value)}
          placeholder={t("mobileRemote.labelInput.placeholder")}
          maxLength={40}
        />
      </div>
    </div>
  );

  const renderInitializing = () => (
    <div className="flex flex-col items-center gap-3 py-10">
      <Loader2 size={28} className="animate-spin text-primary-6" />
      <span className="text-sm text-text-2">
        {t("mobileRemote.pairingDialog.preparing")}
      </span>
    </div>
  );

  const renderAwaiting = () => {
    if (!state.init) return null;
    return (
      <div className="flex flex-col items-center gap-5">
        <span className="text-center text-sm text-text-2">
          {t("mobileRemote.pairingDialog.scanInstruction")}
        </span>

        <QrCanvas payload={state.init.qrPayload} />

        <div className="flex flex-col items-center gap-2">
          <span className="text-center text-xs text-text-3">
            {t("mobileRemote.pairingDialog.confirmPhraseInstruction")}
          </span>
          <SasPhraseDisplay
            phrase={state.init.confirmationPhrase}
            label={t("mobileRemote.pairingDialog.confirmPhraseLabel")}
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-text-3">
          <Loader2 size={14} className="animate-spin" />
          <span>{t("mobileRemote.pairingDialog.waitingForMobile")}</span>
        </div>
      </div>
    );
  };

  const renderSuccess = () => (
    <div className="flex flex-col items-center gap-3 py-8">
      <CheckCircle2 size={36} className="text-success-6" />
      <span className="text-base font-medium text-text-1">
        {t("mobileRemote.pairingDialog.success")}
      </span>
      {state.newDevice && (
        <span className="text-xs text-text-3">{state.newDevice.label}</span>
      )}
    </div>
  );

  const renderError = () => (
    <div className="flex flex-col items-center gap-4 py-6">
      <ShieldAlert size={32} className="text-danger-6" />
      <InlineAlert
        type="danger"
        title={t("mobileRemote.pairingDialog.errorTitle")}
      >
        {state.errorKey ? t(state.errorKey) : t("mobileRemote.errors.unknown")}
      </InlineAlert>
    </div>
  );

  const renderBody = () => {
    switch (state.stage) {
      case "idle":
      case "cancelled":
        return renderForm();
      case "initializing":
        return renderInitializing();
      case "awaitingMobile":
        return renderAwaiting();
      case "success":
        return renderSuccess();
      case "error":
        return renderError();
    }
  };

  const renderHeaderIcon = () => (
    <div className="flex items-center gap-2">
      <Smartphone size={16} className="text-text-2" />
      <span>{t("mobileRemote.pairingDialog.title")}</span>
    </div>
  );

  const isFormStage = state.stage === "idle" || state.stage === "cancelled";
  const isAwaiting =
    state.stage === "awaitingMobile" || state.stage === "initializing";
  const isSuccess = state.stage === "success";
  const isError = state.stage === "error";

  const labelTrimmed = label.trim();

  let modalProps: {
    onOk?: () => void | Promise<void>;
    okText?: string;
    cancelText?: string;
    okButtonProps?: { disabled?: boolean; loading?: boolean };
  } = {};

  if (isFormStage) {
    modalProps = {
      onOk: handleStart,
      okText: t("mobileRemote.pairingDialog.start"),
      cancelText: t("common:actions.cancel"),
      okButtonProps: { disabled: labelTrimmed.length === 0 },
    };
  } else if (isAwaiting) {
    modalProps = {
      cancelText: t("mobileRemote.pairingDialog.cancel"),
    };
  } else if (isSuccess) {
    modalProps = {
      onOk: handleSuccessClose,
      okText: t("common:actions.close"),
      cancelText: "",
    };
  } else if (isError) {
    modalProps = {
      onOk: () => {
        reset();
      },
      okText: t("mobileRemote.pairingDialog.retry"),
      cancelText: t("common:actions.close"),
    };
  }

  return (
    <Modal
      visible={visible}
      onClose={handleClose}
      title={renderHeaderIcon()}
      width={480}
      maskClosable={!isAwaiting}
      escToExit={!isAwaiting}
      {...modalProps}
    >
      {renderBody()}
    </Modal>
  );
};

export default PairingDialog;
