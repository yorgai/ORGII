/**
 * DevRecordSidebar
 *
 * Second-level sidebar for the Dev Record page.
 * Thin wrapper around PageLevelSidebar — back arrow returns to home.
 */
import { BarChart3, GitCommit, History, Sparkles } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import type { DevRecordView } from "@src/store/ui/devRecordToolbarAtom";

import type { PageLevelSidebarItem } from "./PageLevelSidebar";
import PageLevelSidebar from "./PageLevelSidebar";

// ============================================
// Config
// ============================================

const VIEW_ITEMS: {
  key: DevRecordView;
  labelKey: string;
  icon: typeof GitCommit;
}[] = [
  {
    key: "git-dashboard",
    labelKey: "navigation:routes.gitDashboard",
    icon: GitCommit,
  },
  {
    key: "coding-profile",
    labelKey: "navigation:routes.devActivity",
    icon: BarChart3,
  },
  { key: "sessions", labelKey: "sessions.title", icon: History },
  { key: "other-usage", labelKey: "otherUsage.title", icon: Sparkles },
];

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
      VIEW_ITEMS.map((item) => ({
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
