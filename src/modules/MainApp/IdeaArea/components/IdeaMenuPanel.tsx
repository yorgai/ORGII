/**
 * IdeaMenuPanel — left navigation panel for the Idea Area page.
 */
import { Flame, Lightbulb, Share2 } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { MenuPanel, type MenuPanelItem } from "@src/components/ListPanel";

export type IdeaAreaView = "trending" | "shared" | "my-ideas";

const MENU_ITEMS: {
  key: IdeaAreaView;
  labelKey: string;
  icon: typeof Lightbulb;
}[] = [
  { key: "trending", labelKey: "ideaArea.menu.trending", icon: Flame },
  { key: "shared", labelKey: "ideaArea.menu.shared", icon: Share2 },
  { key: "my-ideas", labelKey: "ideaArea.menu.myIdeas", icon: Lightbulb },
];

interface IdeaMenuPanelProps {
  activeView: IdeaAreaView;
  onViewChange: (view: IdeaAreaView) => void;
}

const IdeaMenuPanel: React.FC<IdeaMenuPanelProps> = ({
  activeView,
  onViewChange,
}) => {
  const { t } = useTranslation();

  const items = useMemo<MenuPanelItem<IdeaAreaView>[]>(
    () =>
      MENU_ITEMS.map((m) => ({
        key: m.key,
        label: t(m.labelKey),
        icon: m.icon,
      })),
    [t]
  );

  return (
    <MenuPanel
      items={items}
      activeView={activeView}
      onViewChange={onViewChange}
    />
  );
};

export default IdeaMenuPanel;
