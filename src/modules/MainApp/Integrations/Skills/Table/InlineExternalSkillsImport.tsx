import React from "react";
import { useTranslation } from "react-i18next";

import type { CursorRepo } from "@src/hooks/policies";
import InlineExternalImport from "@src/scaffold/WizardSystem/shared/externalImport/InlineExternalImport";

interface InlineExternalSkillsImportProps {
  cursorRepos?: CursorRepo[];
  forceExpanded?: boolean;
  onCompleted?: () => void;
  onAfterImport?: () => void | Promise<void>;
}

const InlineExternalSkillsImport: React.FC<InlineExternalSkillsImportProps> = ({
  cursorRepos,
  forceExpanded,
  onCompleted,
  onAfterImport,
}) => {
  const { t } = useTranslation("integrations");
  return (
    <InlineExternalImport
      kind="skill"
      labels={{
        title: t("skillsImport.title"),
        empty: t("skillsImport.empty"),
        allImported: t("skillsImport.allImported"),
        itemColumn: t("skillsImport.itemColumn"),
      }}
      cursorRepos={cursorRepos}
      forceExpanded={forceExpanded}
      onCompleted={onCompleted}
      onAfterImport={onAfterImport}
      showSearch
    />
  );
};

export default InlineExternalSkillsImport;
