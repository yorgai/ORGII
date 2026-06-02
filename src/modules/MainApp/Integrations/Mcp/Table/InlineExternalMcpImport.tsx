import { ChevronsDownUp, ChevronsUpDown, Download } from "lucide-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import SettingsTable from "@src/components/SettingsTable";
import type { CursorRepo } from "@src/hooks/policies";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { useExternalImport } from "@src/scaffold/WizardSystem/shared/externalImport/useExternalImport";

interface InlineExternalMcpImportProps {
  cursorRepos?: CursorRepo[];
  onAfterImport?: () => void | Promise<void>;
}

function externalMcpRowKey(row: {
  sourceAgent: string;
  sourcePath: string;
  suggestedName: string;
  targetRepoPath: string | null;
}): string {
  return `${row.sourceAgent}:${row.sourcePath}:${row.suggestedName}:${row.targetRepoPath ?? "global"}`;
}

const InlineExternalMcpImport: React.FC<InlineExternalMcpImportProps> = ({
  cursorRepos,
  onAfterImport,
}) => {
  const { t } = useTranslation("integrations");
  const [expanded, setExpanded] = useState(false);
  const {
    items,
    allImportableItems,
    importableItems,
    searchQuery,
    setSearchQuery,
    selected,
    importLoading,
    importing,
    importError,
    importErrors,
    importColumns,
    handleImport,
  } = useExternalImport({
    kind: "mcp",
    active: expanded,
    cursorRepos,
    onCompleted: () => undefined,
    onRefresh: onAfterImport,
    labels: { itemColumnHeader: t("mcpImport.itemColumn") },
  });

  const hasImportableServers = allImportableItems.length > 0;

  return (
    <SectionContainer>
      <SectionRow label={t("mcpImport.title")}>
        <Button
          variant="secondary"
          icon={
            expanded ? (
              <ChevronsDownUp size={14} />
            ) : (
              <ChevronsUpDown size={14} />
            )
          }
          onClick={() => setExpanded((current) => !current)}
        >
          {t("common:actions.expand")}
        </Button>
      </SectionRow>

      {expanded && (
        <SectionRow showHeader={false} className="pt-0">
          <div className="flex flex-col gap-3">
            {importLoading && items.length === 0 ? null : items.length === 0 ? (
              <div className="rounded-md bg-fill-2 px-3 py-2 text-[12px] text-text-3">
                {t("mcpImport.empty")}
              </div>
            ) : !hasImportableServers ? (
              <div className="rounded-md bg-fill-2 px-3 py-2 text-[12px] text-text-3">
                {t("mcpImport.allImported")}
              </div>
            ) : (
              <SettingsTable
                columns={importColumns}
                rows={importableItems}
                getRowKey={externalMcpRowKey}
                headerHeight="tall"
                searchBar={{
                  searchValue: searchQuery,
                  onSearchChange: setSearchQuery,
                  searchPlaceholder: `${t("common:actions.search")} ${t("mcpImport.itemColumn").toLowerCase()}...`,
                  allowSearchClear: true,
                }}
                emptyTitle={t("common:actions.noResults")}
                noPx
                searchHeaderClassName="-mx-4 w-[calc(100%+2rem)]"
                className="table-settings-expanded-compact"
              />
            )}

            {importError && (
              <div className="rounded border border-solid border-danger-3 bg-danger-1 px-3 py-2 text-[12px] text-danger-6">
                {t("agentOrgs.externalImport.applyFailed", {
                  message: importError,
                })}
              </div>
            )}
            {importErrors.length > 0 && (
              <div className="rounded border border-solid border-warning-3 bg-warning-1 px-3 py-2 text-[12px] text-warning-6">
                <div className="mb-1 font-bold">
                  {t("agentOrgs.externalImport.partialFailure")}
                </div>
                <ul className="list-inside list-disc">
                  {importErrors.map((entry) => (
                    <li key={`${entry.sourcePath}:${entry.targetName}`}>
                      <span className="font-bold">{entry.targetName}</span>:{" "}
                      {entry.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {hasImportableServers && (
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="small"
                  icon={<Download size={14} />}
                  disabled={selected.size === 0}
                  loading={importing}
                  onClick={handleImport}
                >
                  {t("agentOrgs.importSelected", { count: selected.size })}
                </Button>
              </div>
            )}
          </div>
        </SectionRow>
      )}
    </SectionContainer>
  );
};

export default InlineExternalMcpImport;
