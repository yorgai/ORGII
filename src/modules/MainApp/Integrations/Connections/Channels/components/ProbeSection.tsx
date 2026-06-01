/**
 * ProbeSection
 *
 * "Test Connection" button + result card for channel connectivity probing.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import InlineAlert from "@src/components/InlineAlert";

import type { ChannelProbeResult } from "../types";

interface ProbeSectionProps {
  probing: boolean;
  result: ChannelProbeResult | null;
  onProbe: () => void;
  /** Render as compact card (no button, result only) */
  compact?: boolean;
}

const ProbeSection: React.FC<ProbeSectionProps> = ({
  probing,
  result,
  onProbe,
  compact = false,
}) => {
  const { t } = useTranslation("integrations");

  return (
    <div className="flex flex-col gap-3">
      {!compact && (
        <Button
          variant="primary"
          appearance="outline"
          size="default"
          disabled={probing}
          loading={probing}
          onClick={onProbe}
        >
          {t("integrations.testConnection")}
        </Button>
      )}

      {result && (
        <InlineAlert
          type={result.ok ? "success" : "danger"}
          title={`${result.ok ? t("integrations.probeSuccess") : t("integrations.probeFailed")} (${result.elapsed_ms}ms)`}
        >
          {result.identity && (
            <span className="text-[12px]">{result.identity}</span>
          )}
          {result.error && <span className="text-[12px]">{result.error}</span>}
        </InlineAlert>
      )}
    </div>
  );
};

export default ProbeSection;
