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
import { useImportExternalRules } from "@src/scaffold/WizardSystem/variants/Policy/PolicyRuleWizard/useImportExternalRules";

interface InlineExternalRulesImportProps {
  cursorRepos?: CursorRepo[];
  onAfterImport?: () => void | Promise<void>;
}

function externalRuleRowKey(row: {
  sourceAgent: string;
  sourcePath: string;
  targetRepoPath: string | null;
}): string {
  return `${row.sourceAgent}:${row.sourcePath}:${row.targetRepoPath ?? "global"}`;
}

const InlineExternalRulesImport: React.FC<InlineExternalRulesImportProps> = ({
  cursorRepos,
  onAfterImport,
}) => {
  const { t } = useTranslation("integrations");
  const [expanded, setExpanded] = useState(false);
  const {
    rules,
    allImportableRules,
    importableRules,
    searchQuery,
    setSearchQuery,
    selected,
    importLoading,
    importing,
    importError,
    importErrors,
    importColumns,
    handleImport,
  } = useImportExternalRules({
    active: expanded,
    cursorRepos,
    onRefresh: onAfterImport,
  });

  const hasImportableRules = allImportableRules.length > 0;

  return (
    <SectionContainer>
      <SectionRow label={t("rulesImport.title")}>
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
            {importLoading && rules.length === 0 ? null : rules.length === 0 ? (
              <div className="rounded-md bg-fill-2 px-3 py-2 text-[12px] text-text-3">
                {t("rulesImport.empty")}
              </div>
            ) : !hasImportableRules ? (
              <div className="rounded-md bg-fill-2 px-3 py-2 text-[12px] text-text-3">
                {t("rulesImport.allImported")}
              </div>
            ) : (
              <SettingsTable
                columns={importColumns}
                rows={importableRules}
                getRowKey={externalRuleRowKey}
                headerHeight="tall"
                searchBar={{
                  searchValue: searchQuery,
                  onSearchChange: setSearchQuery,
                  searchPlaceholder: `${t("common:actions.search")} ${t("agentOrgs.importRuleColumn").toLowerCase()}...`,
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
                    <li key={entry.sourcePath}>
                      <span className="font-bold">{entry.targetName}</span>:{" "}
                      {entry.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {hasImportableRules && (
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

export default InlineExternalRulesImport;
