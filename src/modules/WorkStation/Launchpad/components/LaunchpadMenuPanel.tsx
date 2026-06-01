/**
 * LaunchpadMenuPanel
 *
 * Left panel: MenuPanel with My Apps / My Repos items + bottom Add button.
 * Follows the WalletMenuPanel pattern (icon+label items, footer slot).
 */
import { FolderPlus, GitFork, Layers } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { MenuPanel, type MenuPanelItem } from "@src/components/ListPanel";

import type { LaunchpadView } from "../config";

interface LaunchpadMenuPanelProps {
  activeView: LaunchpadView;
  onViewChange: (view: LaunchpadView) => void;
  onAddWorkspace: () => void;
}

const MENU_ITEMS: {
  key: LaunchpadView;
  i18nKey: string;
  icon: typeof Layers;
}[] = [
  { key: "myApps", i18nKey: "launchpad.tabs.myApps", icon: Layers },
  { key: "myRepos", i18nKey: "launchpad.tabs.myRepos", icon: GitFork },
];

const LaunchpadMenuPanel: React.FC<LaunchpadMenuPanelProps> = ({
  activeView,
  onViewChange,
  onAddWorkspace,
}) => {
  const { t } = useTranslation("navigation");

  const items = useMemo<MenuPanelItem<LaunchpadView>[]>(
    () =>
      MENU_ITEMS.map((m) => ({
        key: m.key,
        label: t(m.i18nKey),
        icon: m.icon,
      })),
    [t]
  );

  const footer = useMemo(
    () => (
      <div className="flex-shrink-0 p-3">
        <Button
          variant="secondary"
          size="large"
          icon={<FolderPlus size={16} />}
          long
          onClick={onAddWorkspace}
        >
          {t("launchpad.addWorkspace")}
        </Button>
      </div>
    ),
    [onAddWorkspace, t]
  );

  return (
    <MenuPanel
      items={items}
      activeView={activeView}
      onViewChange={onViewChange}
      footer={footer}
    />
  );
};

export default LaunchpadMenuPanel;
