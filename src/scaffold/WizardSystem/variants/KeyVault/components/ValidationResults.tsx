/**
 * ValidationResults — Validation errors + quota bar for the wizard.
 *
 * Renders the dismissible error alert and (when applicable) the quota
 * snapshot. Successful-validation feedback is conveyed by the inline
 * "✓ Validated" button rather than a redundant alert; the auto-detected
 * model list (`ModelsDisplay`, unified catalog + custom rows when applicable)
 * is rendered directly below.
 */
import React, { useState } from "react";

import type { QuotaSnapshot } from "@src/api/types/keyVault";
import InlineAlert from "@src/components/InlineAlert";

import type { AgentCategory } from "../hooks/useApiSetup";
import QuotaDisplay from "./QuotaDisplay";

interface ValidationResultsProps {
  keyValidated: boolean;
  validationError: string | null;
  agentCategory: AgentCategory;
  isApiProvider: boolean;
  extractedQuotaInfo?: QuotaSnapshot;
}

const ValidationResults: React.FC<ValidationResultsProps> = ({
  keyValidated,
  validationError,
  agentCategory,
  isApiProvider,
  extractedQuotaInfo,
}) => {
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const errorDismissed =
    validationError !== null && validationError === dismissedError;

  return (
    <div className="flex flex-col gap-3">
      {keyValidated &&
        extractedQuotaInfo &&
        (agentCategory === "generic" || isApiProvider) && (
          <QuotaDisplay quotaInfo={extractedQuotaInfo} />
        )}

      {validationError && !errorDismissed && (
        <InlineAlert
          type="danger"
          onClose={() => setDismissedError(validationError)}
        >
          {validationError}
        </InlineAlert>
      )}
    </div>
  );
};

export default ValidationResults;
