import { ArrowLeftRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  ChatStatusSegmentedBar,
  ChatStatusTwoLineContent,
} from "@src/engines/ChatPanel/components/ChatStatusBanners";

import { MODE_LABELS } from "./useModeSwitchActions";

export interface ModeSwitchCardBodyProps {
  targetMode: string;
  reason: string;
  onSwitch: () => void;
  onSkip: () => void;
  collapsed?: boolean;
  onCollapse?: () => void;
}

export function ModeSwitchCardBody({
  targetMode,
  reason,
  onSwitch,
  onSkip,
  collapsed = false,
}: ModeSwitchCardBodyProps) {
  const { t } = useTranslation("sessions");
  const modeLabel = MODE_LABELS[targetMode] ?? targetMode;

  if (collapsed) return null;

  return (
    <ChatStatusSegmentedBar
      testId="mode-switch-card"
      data-target-mode={targetMode}
      segments={[
        {
          key: "message",
          className: "flex-1",
          content: (
            <ChatStatusTwoLineContent
              title={t("tools.modeSwitch.label", { mode: modeLabel })}
              description={reason || t("tools.modeSwitch.noReason")}
            />
          ),
        },
        {
          key: "actions",
          className: "shrink-0 px-0",
          content: (
            <span className="inline-flex items-center gap-1">
              <Button
                variant="tertiary"
                shape="round"
                size="mini"
                onClick={onSkip}
                data-testid="mode-switch-skip"
              >
                {t("tools.modeSwitch.skip")}
              </Button>
              <Button
                variant="primary"
                shape="round"
                size="mini"
                onClick={onSwitch}
                data-testid="mode-switch-confirm"
                icon={<ArrowLeftRight size={12} strokeWidth={2} />}
              >
                {t("tools.modeSwitch.switch")}
              </Button>
            </span>
          ),
        },
      ]}
    />
  );
}

ModeSwitchCardBody.displayName = "ModeSwitchCardBody";
