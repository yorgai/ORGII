import { useAtomValue } from "jotai";
import React, { useMemo } from "react";

import type { CursorRepo } from "@src/hooks/policies";
import McpAddWizard from "@src/scaffold/WizardSystem/variants/Mcp/McpAddWizard";
import { reposAtom } from "@src/store/repo";

import type { CategoryTableContentProps } from "../Tables";
import { CategoryTableContent } from "../Tables";
import { McpDetailView } from "./Detail/McpDetailView";
import type { McpDetailState } from "./types";

export const McpCategoryView: React.FC<{
  selectedId: string | null;
  mcp: McpDetailState;
  tableProps: CategoryTableContentProps;
  fullPage: boolean;
  onBack: () => void;
  onExpand?: () => void;
  onClosePreview: () => void;
}> = ({ selectedId, mcp, tableProps, fullPage, onBack }) => {
  const repos = useAtomValue(reposAtom);
  const cursorRepos = useMemo<CursorRepo[]>(
    () =>
      repos
        .filter((repo): repo is typeof repo & { path: string } => !!repo.path)
        .map((repo) => ({ name: repo.name, path: repo.path })),
    [repos]
  );

  if (mcp.addMode) {
    return (
      <McpAddWizard
        onSave={mcp.onSave}
        onTest={mcp.onTest}
        onCancel={mcp.onAddClose}
        editName={mcp.editName ?? undefined}
        editConfig={mcp.editConfig ?? undefined}
        initialScope={mcp.editName ? undefined : mcp.addScope}
      />
    );
  }

  if (fullPage && selectedId) {
    return <McpDetailView selectedId={selectedId} mcp={mcp} onBack={onBack} />;
  }

  const augmentedTableProps: CategoryTableContentProps = {
    ...tableProps,
    mcpTools: mcp.tools,
    mcpResources: mcp.resources,
    onMcpFetchTools: mcp.onFetchTools,
    mcpCursorRepos: cursorRepos,
    onMcpAfterImport: mcp.onRefresh,
    selectedRowId: selectedId,
  };

  return <CategoryTableContent {...augmentedTableProps} category="mcp" />;
};
