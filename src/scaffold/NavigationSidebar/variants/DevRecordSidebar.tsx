/**
 * DevRecordSidebar
 *
 * Second-level sidebar for the Dev Record page.
 * Thin wrapper around PageLevelSidebar — back arrow returns to home.
 */
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import { DEV_RECORD_VIEW_ITEMS } from "@src/modules/MainApp/DevRecord/devRecordViewConfig";
import type { DevRecordView } from "@src/store/ui/devRecordToolbarAtom";

import type { PageLevelSidebarItem } from "./PageLevelSidebar";
import PageLevelSidebar from "./PageLevelSidebar";

// ============================================
// Props
// ============================================

interface DevRecordSidebarProps {
  activeView: DevRecordView;
  onViewChange: (view: DevRecordView) => void;
}

// ============================================
// Component
// ============================================

const DevRecordSidebar: React.FC<DevRecordSidebarProps> = ({
  activeView,
  onViewChange,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const items = useMemo<PageLevelSidebarItem[]>(
    () =>
      DEV_RECORD_VIEW_ITEMS.map((item) => ({
        key: item.key,
        label: t(item.labelKey),
        icon: item.icon,
      })),
    [t]
  );

  return (
    <PageLevelSidebar
      backLabel={t("navigation:routes.devRecord")}
      onBack={() => navigate(ROUTES.app.home.start.path)}
      items={items}
      activeKey={activeView}
      onItemClick={(key) => onViewChange(key as DevRecordView)}
    />
  );
};

export default DevRecordSidebar;
