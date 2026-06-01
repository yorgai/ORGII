import type { TFunction } from "i18next";
import React from "react";

import type { LearningsStatusReport } from "@src/api/tauri/rpc/schemas/learning";
import {
  SECTION_VALUE_SMALL_CLASSES,
  SECTION_VALUE_SMALL_SECONDARY_CLASSES,
} from "@src/modules/shared/layouts/SectionLayout";
import { SECTION_LABEL_COMPACT_CLASSES } from "@src/modules/shared/layouts/SectionLayout/tokens";

import { formatTimestamp } from "./formatters";

interface LearningsStatusCardProps {
  status: LearningsStatusReport;
  t: TFunction;
}

export const LearningsStatusCard: React.FC<LearningsStatusCardProps> = ({
  status,
  t,
}) => (
  <div className="rounded-lg border border-border-2 bg-fill-1 p-4">
    <div className={`mb-2 ${SECTION_LABEL_COMPACT_CLASSES}`}>
      {t("learningsBrowser.statusCard.title")}
    </div>
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <div className={SECTION_VALUE_SMALL_SECONDARY_CLASSES}>
          {t("learningsBrowser.statusCard.lastRun")}
        </div>
        <div className={SECTION_VALUE_SMALL_CLASSES}>
          {status.last_run
            ? formatTimestamp(status.last_run.finished_at)
            : t("learningsBrowser.statusCard.never")}
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className={SECTION_VALUE_SMALL_SECONDARY_CLASSES}>
          {t("learningsBrowser.statusCard.nextTrigger")}
        </div>
        <div className={SECTION_VALUE_SMALL_CLASSES}>
          {status.next_trigger_hint}
        </div>
      </div>
    </div>
  </div>
);
