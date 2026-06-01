import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { PreviewMode } from "../types";

export interface ModeControlProps {
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
}

export function useModeTabsDefinition() {
  const { t } = useTranslation("integrations");
  return useMemo(
    () => [
      { key: "ui" as const, label: t("devTools.modeUi") },
      { key: "tool" as const, label: t("devTools.modeTool") },
      { key: "input" as const, label: t("devTools.modeInput") },
    ],
    [t]
  );
}
