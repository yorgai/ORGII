import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";

export interface AgentControlToolbarProps {
  onNewRound: () => void;
  onPreviousActivity: () => void;
  onNextActivity: () => void;
  onLatestActivity: () => void;
  hasPreviousActivity: boolean;
  hasNextActivity: boolean;
  previousIcon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  nextIcon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  latestIcon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}

export const AgentControlToolbar: React.FC<AgentControlToolbarProps> = ({
  onNewRound,
  onPreviousActivity,
  onNextActivity,
  onLatestActivity,
  hasPreviousActivity,
  hasNextActivity,
  previousIcon: PreviousIcon,
  nextIcon: NextIcon,
  latestIcon: LatestIcon,
}) => {
  const { t } = useTranslation("common");

  return (
    <div className="flex items-center gap-1 border-t border-border-2/50 px-3 py-2">
      <Button
        variant="tertiary"
        size="mini"
        shape="round"
        htmlType="button"
        onClick={onNewRound}
      >
        {t("adeManager.newRound")}
      </Button>
      <Button
        variant="tertiary"
        size="mini"
        shape="circle"
        htmlType="button"
        icon={<PreviousIcon size={12} strokeWidth={1.75} />}
        iconOnly
        disabled={!hasPreviousActivity}
        aria-label={t("actions.previous")}
        onClick={onPreviousActivity}
      />
      <Button
        variant="tertiary"
        size="mini"
        shape="circle"
        htmlType="button"
        icon={<NextIcon size={12} strokeWidth={1.75} />}
        iconOnly
        disabled={!hasNextActivity}
        aria-label={t("actions.next")}
        onClick={onNextActivity}
      />
      <Button
        variant="tertiary"
        size="mini"
        shape="circle"
        htmlType="button"
        icon={<LatestIcon size={12} strokeWidth={1.75} />}
        iconOnly
        disabled={!hasNextActivity}
        aria-label={t("actions.next")}
        onClick={onLatestActivity}
      />
    </div>
  );
};
