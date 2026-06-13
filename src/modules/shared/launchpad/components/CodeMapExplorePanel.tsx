import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import type { CodeMapNode } from "@src/api/tauri/codeMap";
import { useCodeMapNodeDetails } from "@src/hooks/codeMap";
import { CollapsibleSection } from "@src/modules/shared/layouts/blocks";

import CodeMapNodeDetails from "./CodeMapNodeDetails";
import CodeMapSearchPanel from "./CodeMapSearchPanel";

interface CodeMapExplorePanelProps {
  workspacePath?: string | null;
}

export const CodeMapExplorePanel: React.FC<CodeMapExplorePanelProps> = ({
  workspacePath,
}) => {
  const { t } = useTranslation("sessions");
  const { details, loading, error, loadNode } =
    useCodeMapNodeDetails(workspacePath);

  const handleSelectNode = useCallback(
    (node: CodeMapNode) => {
      void loadNode({ nodeId: node.id });
    },
    [loadNode]
  );

  if (!workspacePath) return null;

  return (
    <CollapsibleSection
      title={t("controlTower.codeMap.browser.title")}
      defaultOpen={false}
    >
      <div className="space-y-3">
        <CodeMapSearchPanel
          workspacePath={workspacePath}
          onSelectNode={handleSelectNode}
        />
        {error ? (
          <div className="text-danger-7 rounded-lg bg-danger-1 p-3 text-[12px]">
            {error}
          </div>
        ) : null}
        <CodeMapNodeDetails details={details} loading={loading} />
      </div>
    </CollapsibleSection>
  );
};

export default CodeMapExplorePanel;
