import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export function usePlaygroundVariantTabs(
  isMultiSelect: boolean,
  chatOnly = false
) {
  const { t } = useTranslation("integrations");
  return useMemo(() => {
    const chatTab = { key: "chat" as const, label: t("devTools.variantChat") };
    if (chatOnly) return [chatTab];
    return [
      chatTab,
      {
        key: "simulator" as const,
        label: t("devTools.variantSimulator"),
        disabled: isMultiSelect,
      },
    ];
  }, [t, isMultiSelect, chatOnly]);
}
