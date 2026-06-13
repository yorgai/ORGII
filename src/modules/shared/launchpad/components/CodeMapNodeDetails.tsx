import { FileCode2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import type { CodeMapNodeDetails as CodeMapNodeDetailsData } from "@src/api/tauri/codeMap";

import CodeMapRelationshipList from "./CodeMapRelationshipList";

interface CodeMapNodeDetailsProps {
  details: CodeMapNodeDetailsData | null;
  loading?: boolean;
}

export const CodeMapNodeDetails: React.FC<CodeMapNodeDetailsProps> = ({
  details,
  loading = false,
}) => {
  const { t } = useTranslation("sessions");

  if (loading) {
    return (
      <div className="rounded-lg bg-fill-2 p-4 text-[12px] text-text-3">
        {t("controlTower.codeMap.browser.loadingDetails")}
      </div>
    );
  }

  if (!details) {
    return (
      <div className="rounded-lg bg-fill-2 p-4 text-[12px] text-text-3">
        {t("controlTower.codeMap.browser.selectNode")}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg bg-fill-2 p-4">
      <div className="flex min-w-0 items-start gap-2">
        <FileCode2 size={16} className="mt-0.5 shrink-0 text-text-2" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-text-1">
            {details.node.qualifiedName}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-text-3">
            <span>{details.node.kind}</span>
            <span>·</span>
            <span>{details.node.language}</span>
            <span>·</span>
            <span>
              {details.node.filePath}:{details.node.startLine}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-text-3">
            <span>
              {t("controlTower.codeMap.browser.confidence", {
                value: details.node.confidence,
              })}
            </span>
            <span>·</span>
            <span>
              {t("controlTower.codeMap.browser.extraction", {
                value: details.node.extractionMethod,
              })}
            </span>
          </div>
        </div>
      </div>

      {details.source ? (
        <div className="rounded-md bg-bg-1 p-3">
          <div className="mb-2 text-[12px] font-medium text-text-1">
            {t("controlTower.codeMap.browser.source")}
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-text-2">
            {details.source.text}
          </pre>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <CodeMapRelationshipList
          title={t("controlTower.codeMap.browser.incoming")}
          relationships={details.incoming}
        />
        <CodeMapRelationshipList
          title={t("controlTower.codeMap.browser.outgoing")}
          relationships={details.outgoing}
        />
      </div>
    </div>
  );
};

export default CodeMapNodeDetails;
