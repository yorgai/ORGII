import { Play } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Message from "@src/components/Message";

interface StartAgentButtonProps {
  selectedAccountId?: string;
  selectedModelId?: string;
  onStart: () => void;
  disabled?: boolean;
  size?: "small" | "default";
}

const StartAgentButton: React.FC<StartAgentButtonProps> = ({
  selectedAccountId,
  selectedModelId,
  onStart,
  disabled = false,
  size = "small",
}) => {
  const { t } = useTranslation("projects");

  const handleClick = () => {
    if (!selectedAccountId || !selectedModelId) {
      Message.warning(t("workItems.agentSettings.validationError"));
      return;
    }
    onStart();
  };

  return (
    <Button
      variant="primary"
      size={size}
      icon={<Play size={14} />}
      onClick={handleClick}
      disabled={disabled}
    >
      {t("workItems.agentWorkflow.startAgent")}
    </Button>
  );
};

export default StartAgentButton;
