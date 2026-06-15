/**
 * Menu Component
 *
 * Navigation menu with support for nested submenus.
 *
 *
 * Features:
 * - Nested submenus
 * - Multiple selection modes
 * - Collapsible submenus
 * - Icons support
 * - Horizontal/vertical layouts
 * - Keyboard navigation
 *
 * @example
 * ```tsx
 * import Menu from "@src/components/Menu";
 *
 * <Menu defaultSelectedKeys={['1']}>
 *   <Menu.Item key="1">
 *     <i className="ri-home-line" />
 *     Home
 *   </Menu.Item>
 *   <Menu.SubMenu key="sub1" title="Settings">
 *     <Menu.Item key="2">Profile</Menu.Item>
 *     <Menu.Item key="3">Security</Menu.Item>
 *   </Menu.SubMenu>
 * </Menu>
 * ```
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import React, { createContext, useCallback, useContext, useState } from "react";

import {
  createKeyboardActivationHandler,
  getInteractiveTabIndex,
} from "@src/util/dom/keyboardActivation";

import "./index.scss";

// Menu context for managing state
interface MenuContextValue {
  selectedKeys: string[];
  openKeys: string[];
  mode: "vertical" | "horizontal";
  onSelect: (key: string) => void;
  onOpenChange: (key: string) => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

const useMenuContext = () => {
  const context = useContext(MenuContext);
  if (!context) {
    throw new Error("Menu components must be used within Menu");
  }
  return context;
};

// Menu Props
export interface MenuProps {
  /**
   * Menu mode
   * @default 'vertical'
   */
  mode?: "vertical" | "horizontal";

  /**
   * Default selected keys
   */
  defaultSelectedKeys?: string[];

  /**
   * Default open keys (for submenus)
   */
  defaultOpenKeys?: string[];

  /**
   * Selected keys (controlled)
   */
  selectedKeys?: string[];

  /**
   * Open keys (controlled)
   */
  openKeys?: string[];

  /**
   * Selection callback
   */
  onClickMenuItem?: (key: string) => void;

  /**
   * Open change callback
   */
  onClickSubMenu?: (key: string, openKeys: string[]) => void;

  /**
   * Additional class name
   */
  className?: string;

  /**
   * Additional style
   */
  style?: React.CSSProperties;

  /**
   * Children
   */
  children?: React.ReactNode;
}

// MenuItem Props
export interface MenuItemProps {
  /**
   * Unique key
   */
  key: string;

  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * Click callback
   */
  onClick?: () => void;

  /**
   * Additional class name
   */
  className?: string;

  /**
   * Additional style
   */
  style?: React.CSSProperties;

  /**
   * Children
   */
  children?: React.ReactNode;
}

// SubMenu Props
export interface SubMenuProps {
  /**
   * Unique key
   */
  key: string;

  /**
   * Submenu title
   */
  title: React.ReactNode;

  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * Additional class name
   */
  className?: string;

  /**
   * Additional style
   */
  style?: React.CSSProperties;

  /**
   * Children
   */
  children?: React.ReactNode;
}

// MenuItem Component
const MenuItem: React.FC<MenuItemProps> = ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  key: itemKey,
  disabled = false,
  onClick,
  className = "",
  style,
  children,
}) => {
  const { selectedKeys, onSelect } = useMenuContext();
  const isSelected = selectedKeys.includes(itemKey);

  const handleClick = () => {
    if (disabled) return;
    onSelect(itemKey);
    onClick?.();
  };

  const itemClasses = [
    "menu-item",
    isSelected && "menu-item-selected",
    disabled && "menu-item-disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={itemClasses}
      style={style}
      role="menuitem"
      tabIndex={getInteractiveTabIndex(disabled)}
      aria-disabled={disabled}
      onClick={handleClick}
      onKeyDown={createKeyboardActivationHandler(handleClick)}
    >
      {children}
    </div>
  );
};

// SubMenu Component
const SubMenu: React.FC<SubMenuProps> = ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  key: subMenuKey,
  title,
  disabled = false,
  className = "",
  style,
  children,
}) => {
  const { openKeys, onOpenChange } = useMenuContext();
  const isOpen = openKeys.includes(subMenuKey);

  const handleToggle = () => {
    if (disabled) return;
    onOpenChange(subMenuKey);
  };

  const subMenuClasses = [
    "menu-submenu",
    isOpen && "menu-submenu-open",
    disabled && "menu-submenu-disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={subMenuClasses} style={style}>
      <div
        className="menu-submenu-title"
        role="menuitem"
        tabIndex={getInteractiveTabIndex(disabled)}
        aria-disabled={disabled}
        aria-expanded={isOpen}
        onClick={handleToggle}
        onKeyDown={createKeyboardActivationHandler(handleToggle)}
      >
        <span>{title}</span>
        {isOpen ? (
          <ChevronDown size={16} className="menu-submenu-arrow" />
        ) : (
          <ChevronRight size={16} className="menu-submenu-arrow" />
        )}
      </div>
      {isOpen && <div className="menu-submenu-content">{children}</div>}
    </div>
  );
};

// Main Menu Component
const Menu: React.FC<MenuProps> & {
  Item: typeof MenuItem;
  SubMenu: typeof SubMenu;
} = ({
  mode = "vertical",
  defaultSelectedKeys = [],
  defaultOpenKeys = [],
  selectedKeys: controlledSelectedKeys,
  openKeys: controlledOpenKeys,
  onClickMenuItem,
  onClickSubMenu,
  className = "",
  style,
  children,
}) => {
  const [internalSelectedKeys, setInternalSelectedKeys] =
    useState(defaultSelectedKeys);
  const [internalOpenKeys, setInternalOpenKeys] = useState(defaultOpenKeys);

  const selectedKeys =
    controlledSelectedKeys !== undefined
      ? controlledSelectedKeys
      : internalSelectedKeys;
  const openKeys =
    controlledOpenKeys !== undefined ? controlledOpenKeys : internalOpenKeys;

  const handleSelect = useCallback(
    (key: string) => {
      if (controlledSelectedKeys === undefined) {
        setInternalSelectedKeys([key]);
      }
      onClickMenuItem?.(key);
    },
    [controlledSelectedKeys, onClickMenuItem]
  );

  const handleOpenChange = useCallback(
    (key: string) => {
      const newOpenKeys = openKeys.includes(key)
        ? openKeys.filter((openKey) => openKey !== key)
        : [...openKeys, key];

      if (controlledOpenKeys === undefined) {
        setInternalOpenKeys(newOpenKeys);
      }
      onClickSubMenu?.(key, newOpenKeys);
    },
    [openKeys, controlledOpenKeys, onClickSubMenu]
  );

  const menuClasses = ["menu", `menu-${mode}`, className]
    .filter(Boolean)
    .join(" ");

  const contextValue: MenuContextValue = {
    selectedKeys,
    openKeys,
    mode,
    onSelect: handleSelect,
    onOpenChange: handleOpenChange,
  };

  return (
    <MenuContext.Provider value={contextValue}>
      <div className={menuClasses} style={style} role="menu">
        {children}
      </div>
    </MenuContext.Provider>
  );
};

Menu.Item = MenuItem;
Menu.SubMenu = SubMenu;

export default Menu;
