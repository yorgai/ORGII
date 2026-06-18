import type React from "react";

import type { NavigationMenuItem } from "../config";

export interface NavigationMenuProps {
  items: NavigationMenuItem[];
  selectedKeys: string[];
  onMenuItemClick: (key: string, item: NavigationMenuItem) => void;
  onMenuItemContextMenu?: (
    event: React.MouseEvent,
    key: string,
    item: NavigationMenuItem
  ) => void;
  renderMenuItemWrapper?: (
    item: NavigationMenuItem,
    node: React.ReactElement
  ) => React.ReactElement;
  collapsed?: boolean;
  defaultOpenKeys?: string[];
  enableHoverIconAnimation?: boolean;
  compactRows?: boolean;
}

export type NavigationMenuIconRenderer = (
  icon: NavigationMenuItem["icon"],
  iconName: string | undefined,
  colorClass: string,
  iconElement?: NavigationMenuItem["iconElement"]
) => React.ReactNode;

export type NavigationMenuRowMouseEnterHandler = (
  event: React.MouseEvent,
  routePath?: string
) => void;

export type NavigationMenuRowActionClickHandler = (
  event: React.MouseEvent<HTMLButtonElement>,
  item: NavigationMenuItem
) => void;

export type NavigationMenuItemRenderer = (
  item: NavigationMenuItem,
  isChild?: boolean
) => React.ReactElement;
