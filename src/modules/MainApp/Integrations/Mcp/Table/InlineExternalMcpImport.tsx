import React from "react";
import { useTranslation } from "react-i18next";

import type { CursorRepo } from "@src/hooks/policies";
import InlineExternalImport from "@src/scaffold/WizardSystem/shared/externalImport/InlineExternalImport";

interface InlineExternalMcpImportProps {
  cursorRepos?: CursorRepo[];
  onAfterImport?: () => void | Promise<void>;
}

const InlineExternalMcpImport: React.FC<InlineExternalMcpImportProps> = ({
  cursorRepos,
  onAfterImport,
}) => {
  const { t } = useTranslation("integrations");
  return (
    <InlineExternalImport
      kind="mcp"
      labels={{
        title: t("mcpImport.title"),
        empty: t("mcpImport.empty"),
        allImported: t("mcpImport.allImported"),
        itemColumn: t("mcpImport.itemColumn"),
      }}
      cursorRepos={cursorRepos}
      onAfterImport={onAfterImport}
      showSearch
    />
  );
};

export default InlineExternalMcpImport;
