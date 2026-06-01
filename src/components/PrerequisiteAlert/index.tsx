/**
 * PrerequisiteAlert
 *
 * Inline warning shown when a required binary (npm, brew, pip, etc.)
 * is not found on the user's system. Wraps InlineAlert with type="warning".
 */
import React from "react";
import { useTranslation } from "react-i18next";

import InlineAlert from "@src/components/InlineAlert";

interface PrerequisiteAlertProps {
  /** The binary that is missing (e.g. "npm", "brew", "pip"). */
  binary: string;
  className?: string;
}

const PrerequisiteAlert: React.FC<PrerequisiteAlertProps> = ({
  binary,
  className,
}) => {
  const { t } = useTranslation();

  return (
    <InlineAlert
      type="warning"
      title={t("prerequisite.missingTitle")}
      className={className}
    >
      {t("prerequisite.missing", { binary })}
    </InlineAlert>
  );
};

export default PrerequisiteAlert;
