import React from "react";
import { useTranslation } from "react-i18next";

import type { CursorRepo } from "@src/hooks/policies";
import InlineExternalImport from "@src/scaffold/WizardSystem/shared/externalImport/InlineExternalImport";

interface InlineExternalRulesImportProps {
  cursorRepos?: CursorRepo[];
  onAfterImport?: () => void | Promise<void>;
}

const InlineExternalRulesImport: React.FC<InlineExternalRulesImportProps> = ({
  cursorRepos,
  onAfterImport,
}) => {
  const { t } = useTranslation("integrations");
  return (
    <InlineExternalImport
      kind="policy"
      labels={{
        title: t("rulesImport.title"),
        empty: t("rulesImport.empty"),
        allImported: t("rulesImport.allImported"),
        itemColumn: t("agentOrgs.importRuleColumn"),
      }}
      cursorRepos={cursorRepos}
      onAfterImport={onAfterImport}
      showSearch
    />
  );
};

export default InlineExternalRulesImport;
