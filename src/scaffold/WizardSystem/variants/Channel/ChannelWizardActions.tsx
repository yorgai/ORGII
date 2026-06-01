import { Check } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import { STORY_SYNC_AUTH_METHOD } from "@src/api/http/integrations";
import Button from "@src/components/Button";

import type { ProjectSyncAuthMethod } from "./channelWizardTypes";

interface ChannelWizardActionsProps {
  categorySelected: boolean;
  isChannels: boolean;
  isService: boolean;
  isProjects: boolean;
  selectedType: string | null;
  accountName: string;
  isDuplicateName: boolean;
  channelIsValid: boolean;
  serviceApiKey: string;
  projectAuthMethod: ProjectSyncAuthMethod;
  projectToken: string;
  projectSubmitting: boolean;
  gitDetectReady: boolean;
  gitStoring: boolean;
  onChannelSubmit: () => void;
  onServiceSubmit: () => void;
  onProjectSubmit: () => void;
  onGitAdd: () => void;
}

export const ChannelWizardActions: React.FC<ChannelWizardActionsProps> = ({
  categorySelected,
  isChannels,
  isService,
  isProjects,
  selectedType,
  accountName,
  isDuplicateName,
  channelIsValid,
  serviceApiKey,
  projectAuthMethod,
  projectToken,
  projectSubmitting,
  gitDetectReady,
  gitStoring,
  onChannelSubmit,
  onServiceSubmit,
  onProjectSubmit,
  onGitAdd,
}) => {
  const { t } = useTranslation("integrations");

  if (!categorySelected) return null;

  if (isChannels) {
    return (
      <Button
        variant="primary"
        size="small"
        disabled={
          !selectedType ||
          !accountName.trim() ||
          isDuplicateName ||
          !channelIsValid
        }
        onClick={onChannelSubmit}
      >
        {t("common:actions.done")}
      </Button>
    );
  }

  if (isService) {
    return (
      <Button
        variant="primary"
        size="small"
        disabled={!selectedType || !serviceApiKey.trim()}
        onClick={onServiceSubmit}
      >
        {t("common:actions.done")}
      </Button>
    );
  }

  if (isProjects) {
    if (projectAuthMethod !== STORY_SYNC_AUTH_METHOD.PAT) return null;

    return (
      <Button
        variant="primary"
        size="small"
        disabled={
          !selectedType ||
          !accountName.trim() ||
          isDuplicateName ||
          !projectToken.trim()
        }
        loading={projectSubmitting}
        onClick={onProjectSubmit}
      >
        {t("common:actions.done")}
      </Button>
    );
  }

  return (
    <Button
      variant="primary"
      size="small"
      disabled={!gitDetectReady}
      loading={gitStoring}
      onClick={onGitAdd}
    >
      {t("common:actions.done")}
    </Button>
  );
};

interface ChannelWizardFooterStatusProps {
  isChannels: boolean;
  verified: boolean;
}

export const ChannelWizardFooterStatus: React.FC<
  ChannelWizardFooterStatusProps
> = ({ isChannels, verified }) => {
  const { t } = useTranslation("integrations");

  if (!isChannels || !verified) return undefined;

  return (
    <div className="flex items-center gap-1.5">
      <Check size={14} className="text-success-6" />
      <span className="text-[12px] text-success-6">
        {t("integrations.verified")}
      </span>
    </div>
  );
};
