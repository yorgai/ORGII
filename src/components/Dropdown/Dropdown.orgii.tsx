/**
 * Dropdown Projects
 *
 * Showcases Dropdown component variants and positions.
 * Uses render functions because children/droplist are React elements.
 *
 * @see Documentation/Architecture-Guide/orgii-editor/orgii-project-format-0130.md
 */
import type { OrgiiMeta, OrgiiProject } from "@/src/types/orgii_preview";
import { ChevronDown, MoreHorizontal } from "lucide-react";

import Button from "../Button";
import Menu from "../Menu";
import Dropdown, { type DropdownProps } from "./index";
import { DROPDOWN_ITEM } from "./tokens";

// ============================================
// Meta Configuration
// ============================================

const meta: OrgiiMeta<DropdownProps> = {
  component: Dropdown,
  title: "Components/Dropdown",
  description:
    "Dropdown component with multiple positions and click/hover triggers.",
  argTypes: {
    position: {
      control: "select",
      options: ["top", "bottom", "bottom-start", "bottom-end", "left", "right"],
      description: "Dropdown position",
    },
    trigger: {
      control: "select",
      options: ["click", "hover"],
      description: "Trigger type",
    },
    disabled: {
      control: "boolean",
      description: "Disabled state",
    },
  },
  tags: ["overlay", "interactive"],
};

export default meta;

// ============================================
// Projects
// ============================================

export const Default: OrgiiProject<DropdownProps> = {
  render: () => (
    <Dropdown
      droplist={
        <Menu>
          <Menu.Item key="1">Option 1</Menu.Item>
          <Menu.Item key="2">Option 2</Menu.Item>
          <Menu.Item key="3">Option 3</Menu.Item>
        </Menu>
      }
    >
      <Button variant="secondary">
        Click me <ChevronDown size={DROPDOWN_ITEM.iconSize} />
      </Button>
    </Dropdown>
  ),
  description: "Default dropdown with click trigger",
};

export const Primary: OrgiiProject<DropdownProps> = {
  render: () => (
    <Dropdown
      droplist={
        <Menu>
          <Menu.Item key="edit">Edit</Menu.Item>
          <Menu.Item key="duplicate">Duplicate</Menu.Item>
          <Menu.Item key="delete">Delete</Menu.Item>
        </Menu>
      }
    >
      <Button variant="primary">
        Actions <ChevronDown size={DROPDOWN_ITEM.iconSize} />
      </Button>
    </Dropdown>
  ),
  description: "Primary button trigger",
};

export const HoverTrigger: OrgiiProject<DropdownProps> = {
  render: () => (
    <Dropdown
      trigger="hover"
      droplist={
        <Menu>
          <Menu.Item key="1">Option 1</Menu.Item>
          <Menu.Item key="2">Option 2</Menu.Item>
        </Menu>
      }
    >
      <Button variant="secondary">Hover me</Button>
    </Dropdown>
  ),
  description: "Opens on hover",
};

export const IconButton: OrgiiProject<DropdownProps> = {
  render: () => (
    <Dropdown
      droplist={
        <Menu>
          <Menu.Item key="edit">Edit</Menu.Item>
          <Menu.Item key="delete">Delete</Menu.Item>
        </Menu>
      }
    >
      <Button
        variant="tertiary"
        iconOnly
        icon={<MoreHorizontal size={DROPDOWN_ITEM.iconSize} />}
      />
    </Dropdown>
  ),
  description: "Icon-only trigger",
};

export const UserMenu: OrgiiProject<DropdownProps> = {
  render: () => (
    <Dropdown
      droplist={
        <Menu>
          <Menu.Item key="profile">Profile</Menu.Item>
          <Menu.Item key="settings">Settings</Menu.Item>
          <Menu.Item key="logout">Logout</Menu.Item>
        </Menu>
      }
    >
      <Button variant="secondary">
        Account <ChevronDown size={DROPDOWN_ITEM.iconSize} />
      </Button>
    </Dropdown>
  ),
  description: "User account menu",
};

export const Disabled: OrgiiProject<DropdownProps> = {
  render: () => (
    <Dropdown
      disabled
      droplist={
        <Menu>
          <Menu.Item key="1">Option 1</Menu.Item>
        </Menu>
      }
    >
      <Button variant="secondary">Disabled</Button>
    </Dropdown>
  ),
  description: "Disabled dropdown",
  tags: ["state"],
};

export const PositionTop: OrgiiProject<DropdownProps> = {
  name: "Position: Top",
  render: () => (
    <Dropdown
      position="top"
      droplist={
        <Menu>
          <Menu.Item key="1">Option 1</Menu.Item>
          <Menu.Item key="2">Option 2</Menu.Item>
        </Menu>
      }
    >
      <Button variant="primary">Top</Button>
    </Dropdown>
  ),
  description: "Opens above trigger",
  tags: ["position"],
};

export const PositionRight: OrgiiProject<DropdownProps> = {
  name: "Position: Right",
  render: () => (
    <Dropdown
      position="right"
      droplist={
        <Menu>
          <Menu.Item key="1">Option 1</Menu.Item>
          <Menu.Item key="2">Option 2</Menu.Item>
        </Menu>
      }
    >
      <Button variant="primary">Right</Button>
    </Dropdown>
  ),
  description: "Opens to the right",
  tags: ["position"],
};
