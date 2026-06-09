import React from "react";

import type { CategoryTableContentProps } from "../Tables";
import { CategoryTableContent } from "../Tables";
import type { ChannelSlice } from "../types";
import ChannelPreviewPanel from "./Channels/ChannelPreviewPanel";

export const ConnectionsCategoryView: React.FC<{
  selectedIntegrationKind: "git" | "channel" | null;
  selectedGitProvider: string | null;
  onGitConnected?: () => void;
  channel: ChannelSlice;
  tableProps: CategoryTableContentProps;
  fullPage: boolean;
  onBack: () => void;
  onExpand?: () => void;
  onClosePreview: () => void;
}> = ({
  selectedIntegrationKind,
  selectedGitProvider,
  onGitConnected,
  channel,
  tableProps,
  fullPage,
  onBack,
  onExpand,
  onClosePreview,
}) => {
  if (channel.channelWizardMode) {
    return (
      <ChannelPreviewPanel
        channel={channel}
        onGitConnected={onGitConnected}
        onClose={onClosePreview}
      />
    );
  }

  if (fullPage) {
    if (selectedIntegrationKind === "channel" || channel.selectedChannel) {
      return (
        <ChannelPreviewPanel
          channel={channel}
          onClose={onBack}
          onExpand={onExpand}
        />
      );
    }
  }

  const connectionSelectedRowId =
    selectedIntegrationKind === "git" && selectedGitProvider
      ? `git:${selectedGitProvider}`
      : channel.selectedChannel
        ? `${channel.selectedChannel.type}:${channel.selectedChannel.accountId}`
        : null;

  const augmentedProps: CategoryTableContentProps = {
    ...tableProps,
    selectedRowId: connectionSelectedRowId,
  };

  return <CategoryTableContent {...augmentedProps} category="connections" />;
};
