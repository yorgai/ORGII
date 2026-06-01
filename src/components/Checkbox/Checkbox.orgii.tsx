/**
 * Checkbox Projects
 *
 * Showcases Checkbox component variants and states.
 *
 * @see Documentation/Architecture-Guide/orgii-editor/orgii-project-format-0130.md
 */
import type { OrgiiMeta, OrgiiProject } from "@/src/types/orgii_preview";

import Checkbox, { type CheckboxProps } from "./index";

// ============================================
// Meta Configuration
// ============================================

const meta: OrgiiMeta<CheckboxProps> = {
  component: Checkbox,
  title: "Components/Checkbox",
  description:
    "Checkbox component with indeterminate state, sizes, and group support.",
  args: {
    size: "default",
    disabled: false,
    indeterminate: false,
  },
  argTypes: {
    checked: {
      control: "boolean",
      description: "Checked state",
    },
    indeterminate: {
      control: "boolean",
      description: "Indeterminate state",
    },
    disabled: {
      control: "boolean",
      description: "Disabled state",
    },
    size: {
      control: "select",
      options: ["mini", "small", "default", "large"],
      description: "Checkbox size",
    },
  },
  tags: ["form", "interactive", "core"],
};

export default meta;

// ============================================
// Basic States
// ============================================

export const Default: OrgiiProject<CheckboxProps> = {
  args: {
    children: "Default Checkbox",
  },
  description: "Unchecked checkbox",
};

export const Checked: OrgiiProject<CheckboxProps> = {
  args: {
    checked: true,
    children: "Checked",
  },
  description: "Checked checkbox",
};

export const Indeterminate: OrgiiProject<CheckboxProps> = {
  args: {
    indeterminate: true,
    children: "Indeterminate",
  },
  description: "Partial selection state",
  tags: ["state"],
};

export const Disabled: OrgiiProject<CheckboxProps> = {
  args: {
    disabled: true,
    children: "Disabled",
  },
  description: "Disabled checkbox",
  tags: ["state"],
};

export const DisabledChecked: OrgiiProject<CheckboxProps> = {
  args: {
    disabled: true,
    checked: true,
    children: "Disabled Checked",
  },
  description: "Disabled and checked",
  tags: ["state"],
};

// ============================================
// Sizes
// ============================================

export const SizeMini: OrgiiProject<CheckboxProps> = {
  name: "Size: Mini",
  args: {
    size: "mini",
    children: "Mini",
  },
  description: "Smallest size",
  tags: ["size"],
};

export const SizeSmall: OrgiiProject<CheckboxProps> = {
  name: "Size: Small",
  args: {
    size: "small",
    children: "Small",
  },
  description: "Small size",
  tags: ["size"],
};

export const SizeDefault: OrgiiProject<CheckboxProps> = {
  name: "Size: Default",
  args: {
    size: "default",
    children: "Default",
  },
  description: "Default size",
  tags: ["size"],
};

export const SizeLarge: OrgiiProject<CheckboxProps> = {
  name: "Size: Large",
  args: {
    size: "large",
    children: "Large",
  },
  description: "Large size",
  tags: ["size"],
};

// ============================================
// Without Label
// ============================================

export const NoLabel: OrgiiProject<CheckboxProps> = {
  args: {},
  description: "Checkbox without label",
  tags: ["edge-case"],
};

export const NoLabelChecked: OrgiiProject<CheckboxProps> = {
  args: {
    checked: true,
  },
  description: "Checked without label",
  tags: ["edge-case"],
};

// ============================================
// Groups
// ============================================

export const GroupHorizontal: OrgiiProject<CheckboxProps> = {
  render: () => (
    <Checkbox.Group defaultValue={["apple"]} direction="horizontal">
      <Checkbox value="apple">Apple</Checkbox>
      <Checkbox value="banana">Banana</Checkbox>
      <Checkbox value="orange">Orange</Checkbox>
    </Checkbox.Group>
  ),
  description: "Horizontal group",
  tags: ["group"],
};

export const GroupVertical: OrgiiProject<CheckboxProps> = {
  render: () => (
    <Checkbox.Group defaultValue={["a"]} direction="vertical">
      <Checkbox value="a">Option A</Checkbox>
      <Checkbox value="b">Option B</Checkbox>
      <Checkbox value="c">Option C</Checkbox>
    </Checkbox.Group>
  ),
  description: "Vertical group",
  tags: ["group"],
};

export const GroupDisabled: OrgiiProject<CheckboxProps> = {
  render: () => (
    <Checkbox.Group defaultValue={["a"]} disabled direction="vertical">
      <Checkbox value="a">Option A</Checkbox>
      <Checkbox value="b">Option B</Checkbox>
    </Checkbox.Group>
  ),
  description: "Disabled group",
  tags: ["group", "state"],
};

// ============================================
// Composite
// ============================================

export const AllSizes: OrgiiProject<CheckboxProps> = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
      <Checkbox size="mini" checked>
        Mini
      </Checkbox>
      <Checkbox size="small" checked>
        Small
      </Checkbox>
      <Checkbox size="default" checked>
        Default
      </Checkbox>
      <Checkbox size="large" checked>
        Large
      </Checkbox>
    </div>
  ),
  description: "All sizes",
  tags: ["composite"],
};

export const AllStates: OrgiiProject<CheckboxProps> = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <Checkbox>Unchecked</Checkbox>
      <Checkbox checked>Checked</Checkbox>
      <Checkbox indeterminate>Indeterminate</Checkbox>
      <Checkbox disabled>Disabled</Checkbox>
      <Checkbox disabled checked>
        Disabled Checked
      </Checkbox>
    </div>
  ),
  description: "All states",
  tags: ["composite"],
};
