import React from "react";

import type { CategoryTableContentProps } from "../Tables";
import { CategoryTableContent } from "../Tables";
import type { ChannelSlice } from "../types";
import type { ServiceType } from "./Channels";
import ChannelPreviewPanel from "./Channels/ChannelPreviewPanel";
import GitProviderDetailPanel from "./Git/GitProviderDetailPanel";
import ServicePreviewPanel from "./Services/Preview/ServicePreviewPanel";

export const ConnectionsCategoryView: React.FC<{
  selectedIntegrationKind: "git" | "channel" | "service" | null;
  selectedGitProvider: string | null;
  selectedServiceType: ServiceType | null;
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
  selectedServiceType,
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
    if (selectedIntegrationKind === "git") {
      return (
        <GitProviderDetailPanel
          selectedProvider={selectedGitProvider}
          onBack={onBack}
          onExpand={onExpand}
        />
      );
    }
    if (selectedIntegrationKind === "service" && selectedServiceType) {
      return (
        <ServicePreviewPanel
          serviceType={selectedServiceType}
          config={channel.config}
          update={channel.update}
          onClose={onBack}
          onExpand={onExpand}
        />
      );
    }
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
