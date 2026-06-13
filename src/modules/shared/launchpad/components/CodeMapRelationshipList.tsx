import React from "react";
import { useTranslation } from "react-i18next";

import type { CodeMapRelationship } from "@src/api/tauri/codeMap";

interface CodeMapRelationshipListProps {
  title: string;
  relationships: CodeMapRelationship[];
}

export const CodeMapRelationshipList: React.FC<
  CodeMapRelationshipListProps
> = ({ title, relationships }) => {
  const { t } = useTranslation("sessions");

  if (relationships.length === 0) {
    return (
      <div className="rounded-md bg-fill-2 p-3 text-[12px] text-text-3">
        {t("controlTower.codeMap.browser.noRelationships")}
      </div>
    );
  }

  return (
    <div className="rounded-md bg-fill-2 p-3">
      <div className="mb-2 text-[12px] font-semibold text-text-1">{title}</div>
      <div className="space-y-2">
        {relationships.map((relationship) => (
          <div
            key={`${relationship.edge.source}-${relationship.edge.target}-${relationship.edge.kind}-${relationship.edge.line ?? 0}`}
            className="rounded bg-bg-1 px-3 py-2"
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate text-[12px] font-medium text-text-1">
                {relationship.node.qualifiedName}
              </span>
              <span className="shrink-0 rounded bg-fill-3 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-3">
                {relationship.edge.kind}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-text-3">
              <span>{relationship.node.filePath}</span>
              <span>·</span>
              <span>
                {t("controlTower.codeMap.browser.confidence", {
                  value: relationship.edge.confidence,
                })}
              </span>
              <span>·</span>
              <span>
                {t("controlTower.codeMap.browser.resolution", {
                  value: relationship.edge.resolutionStatus,
                })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CodeMapRelationshipList;
