/**
 * FactoryViewPill
 *
 * Header tabs for the Ops Control station.
 * Toggles between Kanban board, list view, and daily Diary.
 *
 * View is stored in the URL search param `?view=kanban|list|diary`
 * so it survives navigation and can be bookmarked/shared. Defaults to
 * "kanban".
 */
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import TabPill, { type TabPillItem } from "@src/components/TabPill";

export type FactoryViewMode = "kanban" | "list" | "diary";

export function parseFactoryViewMode(search: string): FactoryViewMode {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view === "list") return "list";
  if (view === "diary") return "diary";
  return "kanban";
}

const FactoryViewPill: React.FC = () => {
  const { t } = useTranslation("sessions");
  const navigate = useNavigate();
  const location = useLocation();

  const activeView = parseFactoryViewMode(location.search);
  const tabs = useMemo<TabPillItem[]>(
    () => [
      { key: "kanban", label: t("kanban.view.kanban") },
      { key: "list", label: t("kanban.view.list") },
      { key: "diary", label: t("kanban.view.diary") },
    ],
    [t]
  );

  const handleViewChange = useCallback(
    (view: FactoryViewMode) => {
      const params = new URLSearchParams(location.search);
      if (view === "kanban") {
        params.delete("view");
      } else {
        params.set("view", view);
      }
      const search = params.toString();
      navigate({ search: search ? `?${search}` : "" }, { replace: true });
    },
    [navigate, location.search]
  );

  return (
    <TabPill
      activeTab={activeView}
      tabs={tabs}
      onChange={(key) => handleViewChange(key as FactoryViewMode)}
      variant="pill"
      color="fill"
      fillWidth={false}
      size="small"
    />
  );
};

export default FactoryViewPill;
