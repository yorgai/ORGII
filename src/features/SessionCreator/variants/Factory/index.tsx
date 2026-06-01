import React from "react";
import { useTranslation } from "react-i18next";

import { SESSION_CREATOR_LAUNCH_MODE } from "@src/features/SessionCreator/types";

import SessionCreatorShell from "../../Shell";

export interface SessionCreatorFactoryProps {
  className?: string;
  onSessionStart?: () => void;
  onClose?: () => void;
}

const SessionCreatorFactory: React.FC<SessionCreatorFactoryProps> = ({
  className,
  onSessionStart,
  onClose,
}) => {
  const { t } = useTranslation("sessions");

  return (
    <SessionCreatorShell
      className={className}
      onSessionStart={onSessionStart}
      onClose={onClose}
      launchMode={SESSION_CREATOR_LAUNCH_MODE.START_BACKGROUND}
      launchLabel={t("creator.assign")}
      layout="factory"
    />
  );
};

export default SessionCreatorFactory;
