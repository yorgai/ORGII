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

interface InlineExternalAgentsImportProps {
  cursorRepos?: CursorRepo[];
  forceExpanded?: boolean;
  onCompleted?: () => void;
  onAfterImport?: () => void | Promise<void>;
}

function externalAgentRowKey(row: {
  sourceAgent: string;
  sourcePath: string;
  suggestedName: string;
}): string {
  return `${row.sourceAgent}:${row.sourcePath}:${row.suggestedName}`;
}

const InlineExternalAgentsImport: React.FC<InlineExternalAgentsImportProps> = ({
  cursorRepos,
  forceExpanded = false,
  onCompleted,
  onAfterImport,
}) => {
  const { t } = useTranslation("integrations");
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const expanded = forceExpanded || manuallyExpanded;

  const {
    items,
    importableItems,
    selected,
    importLoading,
    importing,
    importError,
    importErrors,
    importColumns,
    handleImport,
  } = useExternalImport({
    kind: "agent_definition",
    active: expanded,
    cursorRepos,
    onCompleted: onCompleted ?? (() => undefined),
    onRefresh: onAfterImport,
    labels: { itemColumnHeader: t("agentOrgs.importAgentColumn") },
  });

  const hasImportableAgents = importableItems.length > 0;

  return (
    <SectionContainer>
      <SectionRow label={t("agentOrgs.importAgentTitle")}>
        <Button
          variant="secondary"
          icon={
            expanded ? (
              <ChevronsDownUp size={14} />
            ) : (
              <ChevronsUpDown size={14} />
            )
          }
          onClick={() => {
            if (forceExpanded) {
              onCompleted?.();
              return;
            }
            setManuallyExpanded((current) => !current);
          }}
        >
          {t("common:actions.expand")}
        </Button>
      </SectionRow>

      {expanded && (
        <SectionRow showHeader={false} className="pt-0">
          <div className="flex flex-col gap-3">
            {importLoading && items.length === 0 ? null : items.length === 0 ? (
              <div className="rounded-md bg-fill-2 px-3 py-2 text-[12px] text-text-3">
                {t("agentOrgs.externalImport.noAgentResults")}
              </div>
            ) : !hasImportableAgents ? (
              <div className="rounded-md bg-fill-2 px-3 py-2 text-[12px] text-text-3">
                {t("agentOrgs.allImported", {
                  item: t("agentOrgs.importedItemAgents"),
                })}
              </div>
            ) : (
              <SettingsTable
                columns={importColumns}
                rows={importableItems}
                getRowKey={externalAgentRowKey}
                headerHeight="tall"
                noPx
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

            {hasImportableAgents && (
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

export default InlineExternalAgentsImport;
