import { Search } from "lucide-react";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CodeMapNode } from "@src/api/tauri/codeMap";
import Button from "@src/components/Button";
import InlineAlert from "@src/components/InlineAlert";
import { useCodeMapSearch } from "@src/hooks/codeMap";

interface CodeMapSearchPanelProps {
  workspacePath?: string | null;
  onSelectNode: (node: CodeMapNode) => void;
}

export const CodeMapSearchPanel: React.FC<CodeMapSearchPanelProps> = ({
  workspacePath,
  onSelectNode,
}) => {
  const { t } = useTranslation("sessions");
  const [query, setQuery] = useState("");
  const { result, loading, error, search } = useCodeMapSearch(workspacePath);

  const handleSearch = useCallback(() => {
    void search(query);
  }, [query, search]);

  return (
    <div className="rounded-lg bg-fill-2 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Search size={14} className="text-text-2" />
        <h3 className="text-[13px] font-semibold text-text-1">
          {t("controlTower.codeMap.browser.searchTitle")}
        </h3>
      </div>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSearch();
          }}
          placeholder={t("controlTower.codeMap.browser.searchPlaceholder")}
          className="min-w-0 flex-1 rounded-md border border-border-2 bg-bg-1 px-3 py-2 text-[12px] text-text-1 outline-none transition-colors placeholder:text-text-4 focus:border-primary-6"
        />
        <Button
          variant="primary"
          size="small"
          shape="round"
          loading={loading}
          disabled={!query.trim() || loading || !workspacePath}
          onClick={handleSearch}
        >
          {t("controlTower.codeMap.browser.search")}
        </Button>
      </div>

      {error ? (
        <div className="mt-3">
          <InlineAlert
            type="danger"
            title={t("controlTower.codeMap.errorTitle")}
          >
            {error}
          </InlineAlert>
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] text-text-3">
            {t("controlTower.codeMap.browser.resultSummary", {
              count: result.results.length,
              unresolved: result.unresolvedCount,
              stale: result.staleFiles,
            })}
          </div>
          {result.results.length === 0 ? (
            <div className="rounded-md bg-bg-1 p-3 text-[12px] text-text-3">
              {t("controlTower.codeMap.browser.noResults")}
            </div>
          ) : (
            <div className="max-h-72 space-y-2 overflow-auto pr-1">
              {result.results.map((item) => (
                <button
                  key={item.node.id}
                  type="button"
                  onClick={() => onSelectNode(item.node)}
                  className="w-full rounded-md bg-bg-1 px-3 py-2 text-left transition-colors hover:bg-fill-3"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-medium text-text-1">
                      {item.node.qualifiedName}
                    </span>
                    <span className="shrink-0 rounded bg-fill-3 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-3">
                      {item.node.kind}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-text-3">
                    {item.node.filePath}:{item.node.startLine} ·{" "}
                    {item.node.language} · {item.node.confidence}
                  </div>
                  <div className="mt-1 text-[11px] text-text-3">
                    {t("controlTower.codeMap.browser.relationshipCounts", {
                      incoming: item.incomingCount,
                      outgoing: item.outgoingCount,
                    })}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default CodeMapSearchPanel;
