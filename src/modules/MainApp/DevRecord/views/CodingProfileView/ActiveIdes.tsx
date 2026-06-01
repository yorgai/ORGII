import React, { memo, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getDevRecordActiveIdes } from "@src/api/tauri/devRecord";
import type { DetectedIde } from "@src/api/tauri/devRecord/types";
import SoftwareIcon from "@src/components/SoftwareIcon";
import {
  CollapsibleSection,
  Placeholder,
} from "@src/modules/shared/layouts/blocks";

import { type FetchResult, formatSourceLabel } from "./config";

interface ActiveIdesProps {
  refreshKey?: number;
}

const ActiveIdes: React.FC<ActiveIdesProps> = memo(({ refreshKey }) => {
  const { t } = useTranslation();

  const [retryCount, setRetryCount] = useState(0);
  const fetchKey = `active-ides:${refreshKey ?? 0}:${retryCount}`;
  const [result, setResult] = useState<FetchResult<DetectedIde[]> | null>(null);
  const validResult = result?.key === fetchKey ? result : null;

  const handleRetry = useCallback(() => {
    setRetryCount((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const effectKey = `active-ides:${refreshKey ?? 0}:${retryCount}`;
    let cancelled = false;

    getDevRecordActiveIdes()
      .then((data) => {
        if (!cancelled) setResult({ key: effectKey, data, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setResult({
            key: effectKey,
            data: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey, retryCount]);

  const activeIdes = (validResult ?? result)?.data ?? [];

  if (!result) return <Placeholder variant="loading" />;
  if (validResult?.error)
    return (
      <Placeholder
        variant="error"
        title={validResult.error}
        onRetry={handleRetry}
      />
    );
  if (activeIdes.length === 0) return null;

  return (
    <CollapsibleSection title={t("devActivity.activeIdes")}>
      <div className="flex flex-wrap gap-2">
        {activeIdes.map((ide) => (
          <div
            key={ide.pid}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] ${
              ide.isFrontmost
                ? "bg-fill-2 text-text-1"
                : "bg-fill-2 text-text-2"
            }`}
          >
            <SoftwareIcon type={ide.source} size={14} />
            <span>{formatSourceLabel(ide.source)}</span>
            <span className="text-text-2">{ide.processName}</span>
            {ide.isFrontmost && (
              <span className="rounded bg-primary-1 px-1.5 py-0.5 text-[10px] text-primary-6">
                {t("devActivity.active")}
              </span>
            )}
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
});

ActiveIdes.displayName = "ActiveIdes";

export default ActiveIdes;
