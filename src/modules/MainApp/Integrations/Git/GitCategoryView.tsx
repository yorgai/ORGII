import React from "react";

import type { GitHubConnection } from "@src/api/http/github/types";

import GitProviderDetailPanel from "../Connections/Git/GitProviderDetailPanel";
import type { DetailMode } from "../types";
import { GitTable } from "./Table/GitTable";

interface GitCategoryViewProps {
  connections: GitHubConnection[];
  loading: boolean;
  selectedProvider: string | null;
  fullPage: boolean;
  onSelectProvider: (provider: string | null, mode?: DetailMode) => void;
  onAfterAddOpen?: () => void | Promise<void>;
  onBack?: () => void;
  onExpand?: () => void;
}

export const GitCategoryView: React.FC<GitCategoryViewProps> = ({
  connections,
  loading,
  selectedProvider,
  fullPage,
  onSelectProvider,
  onAfterAddOpen,
  onBack,
  onExpand,
}) => {
  if (fullPage) {
    return (
      <GitProviderDetailPanel
        selectedProvider={selectedProvider}
        onBack={onBack}
        onExpand={onExpand}
      />
    );
  }

  return (
    <GitTable
      connections={connections}
      loading={loading}
      selectedRowId={selectedProvider}
      onSelectProvider={onSelectProvider}
      onAfterAddOpen={onAfterAddOpen}
    />
  );
};
