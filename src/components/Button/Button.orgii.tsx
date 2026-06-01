/**
 * Button Projects
 *
 * Showcases the Button component across the new (variant, appearance)
 * design space. Used for isolated development, visual testing, and AI
 * context.
 *
 * @see Documentation/Architecture-Guide/orgii-editor/orgii-project-format-0130.md
 */
import type { OrgiiMeta, OrgiiProject } from "@/src/types/orgii_preview";
import { Download, Plus, Send, Trash2 } from "lucide-react";

import Button, { type ButtonProps } from "./index";

const meta: OrgiiMeta<ButtonProps> = {
  component: Button,
  title: "Components/Button",
  description:
    "Native button component. Two orthogonal axes: `variant` (importance / role) and `appearance` (visual treatment). Plus sizes, shapes, and loading states.",
  args: {
    variant: "secondary",
    appearance: "outline",
    size: "default",
    shape: "square",
  },
  argTypes: {
    variant: {
      control: "select",
      options: [
        "primary",
        "secondary",
        "tertiary",
        "danger",
        "warning",
        "success",
      ],
      description: "Importance / semantic role",
    },
    appearance: {
      control: "select",
      options: ["solid", "outline", "dashed", "ghost"],
      description: "Visual treatment",
    },
    size: {
      control: "select",
      options: ["mini", "small", "default", "large"],
      description: "Button size",
    },
    shape: {
      control: "select",
      options: ["square", "round", "circle"],
      description: "Button shape",
    },
    loading: { control: "boolean", description: "Shows loading spinner" },
    disabled: { control: "boolean", description: "Disables the button" },
    iconOnly: {
      control: "boolean",
      description: "Renders only the icon without text",
    },
    long: { control: "boolean", description: "Button takes full width" },
    onClick: { action: "clicked" },
  },
  tags: ["form", "interactive", "core"],
};

export default meta;

// ============================================
// Variants (importance / role)
// ============================================

export const Primary: OrgiiProject<ButtonProps> = {
  args: { variant: "primary", children: "Primary" },
  description: "Brand-colored CTA",
};

export const Secondary: OrgiiProject<ButtonProps> = {
  args: { variant: "secondary", children: "Secondary" },
  description: "Regular bordered action",
};

export const Tertiary: OrgiiProject<ButtonProps> = {
  args: { variant: "tertiary", children: "Tertiary" },
  description: "Inline / supporting action — subtle hover fill",
};

export const Danger: OrgiiProject<ButtonProps> = {
  args: {
    variant: "danger",
    children: "Delete",
    icon: <Trash2 size={14} />,
  },
  description: "Destructive solid action",
};

export const Warning: OrgiiProject<ButtonProps> = {
  args: { variant: "warning", children: "Warning" },
  description: "Caution-required action",
};

export const Success: OrgiiProject<ButtonProps> = {
  args: { variant: "success", children: "Confirm" },
  description: "Positive confirmation",
};

// ============================================
// Appearances (visual treatment)
// ============================================

export const Solid: OrgiiProject<ButtonProps> = {
  args: { variant: "primary", appearance: "solid", children: "Solid" },
  description: "Filled background — default for primary/danger/warning/success",
  tags: ["appearance"],
};

export const Outline: OrgiiProject<ButtonProps> = {
  args: { variant: "primary", appearance: "outline", children: "Outline" },
  description: "Bordered, transparent fill",
  tags: ["appearance"],
};

export const Dashed: OrgiiProject<ButtonProps> = {
  args: { variant: "secondary", appearance: "dashed", children: "Add Item" },
  description: "Dashed border for add/upload affordances",
  tags: ["appearance"],
};

export const Ghost: OrgiiProject<ButtonProps> = {
  args: { variant: "tertiary", appearance: "ghost", children: "Ghost" },
  description:
    "No border, no fill — hover changes only the text color. Use for inline tertiary actions and palette footers.",
  tags: ["appearance"],
};

export const GhostDanger: OrgiiProject<ButtonProps> = {
  name: "Ghost (Danger)",
  args: {
    variant: "danger",
    appearance: "ghost",
    icon: <Trash2 size={14} />,
    children: "Remove",
  },
  description: "Destructive inline action — colored text, no fill",
  tags: ["appearance"],
};

// ============================================
// Sizes
// ============================================

export const SizeMini: OrgiiProject<ButtonProps> = {
  name: "Size: Mini",
  args: { variant: "primary", size: "mini", children: "Mini" },
  description: "24px height",
  tags: ["size"],
};

export const SizeSmall: OrgiiProject<ButtonProps> = {
  name: "Size: Small",
  args: { variant: "primary", size: "small", children: "Small" },
  description: "28px height",
  tags: ["size"],
};

export const SizeDefault: OrgiiProject<ButtonProps> = {
  name: "Size: Default",
  args: { variant: "primary", size: "default", children: "Default" },
  description: "32px height",
  tags: ["size"],
};

export const SizeLarge: OrgiiProject<ButtonProps> = {
  name: "Size: Large",
  args: { variant: "primary", size: "large", children: "Large" },
  description: "40px height",
  tags: ["size"],
};

// ============================================
// Shapes
// ============================================

export const ShapeSquare: OrgiiProject<ButtonProps> = {
  name: "Shape: Square",
  args: { variant: "primary", shape: "square", children: "Square" },
  description: "Standard 8px-radius corners",
  tags: ["shape"],
};

export const ShapeRound: OrgiiProject<ButtonProps> = {
  name: "Shape: Round",
  args: { variant: "primary", shape: "round", children: "Round Button" },
  description: "Pill-shaped",
  tags: ["shape"],
};

export const ShapeCircle: OrgiiProject<ButtonProps> = {
  name: "Shape: Circle",
  args: {
    variant: "primary",
    shape: "circle",
    icon: <Plus size={16} />,
    iconOnly: true,
  },
  description: "Circular icon-only",
  tags: ["shape"],
};

// ============================================
// With Icons
// ============================================

export const WithIconLeft: OrgiiProject<ButtonProps> = {
  name: "With Icon (Left)",
  args: {
    variant: "primary",
    icon: <Download size={14} />,
    children: "Download",
  },
  description: "Icon on the left",
  tags: ["icon"],
};

export const IconOnly: OrgiiProject<ButtonProps> = {
  args: { variant: "secondary", icon: <Plus size={14} />, iconOnly: true },
  description: "Icon-only",
  tags: ["icon"],
};

export const IconOnlyCircle: OrgiiProject<ButtonProps> = {
  name: "Icon Only Circle",
  args: {
    variant: "primary",
    shape: "circle",
    icon: <Send size={14} />,
    iconOnly: true,
  },
  description: "FAB-style circular icon button",
  tags: ["icon"],
};

// ============================================
// States
// ============================================

export const Loading: OrgiiProject<ButtonProps> = {
  args: { variant: "primary", loading: true, children: "Submitting..." },
  description: "Loading spinner; auto-disables",
  tags: ["state"],
};

export const LoadingWithIcon: OrgiiProject<ButtonProps> = {
  name: "Loading (replaces icon)",
  args: {
    variant: "primary",
    loading: true,
    icon: <Send size={14} />,
    children: "Sending...",
  },
  description: "Spinner replaces the icon",
  tags: ["state"],
};

export const Disabled: OrgiiProject<ButtonProps> = {
  args: { variant: "primary", disabled: true, children: "Disabled" },
  description: "Reduced opacity, no-cursor",
  tags: ["state"],
};

// ============================================
// Layout
// ============================================

export const FullWidth: OrgiiProject<ButtonProps> = {
  args: { variant: "primary", long: true, children: "Full Width Button" },
  description: "100% of container width",
  tags: ["layout"],
};

// ============================================
// Composite
// ============================================

export const ButtonGroup: OrgiiProject<ButtonProps> = {
  render: (args) => (
    <div style={{ display: "flex", gap: "8px" }}>
      <Button {...args} variant="primary">
        Save
      </Button>
      <Button {...args} variant="secondary">
        Cancel
      </Button>
      <Button {...args} variant="danger" appearance="ghost">
        Delete
      </Button>
    </div>
  ),
  args: { size: "default" },
  description: "Save / Cancel / Delete group",
  tags: ["composite"],
};

export const AllSizes: OrgiiProject<ButtonProps> = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <Button variant="primary" size="mini">
        Mini
      </Button>
      <Button variant="primary" size="small">
        Small
      </Button>
      <Button variant="primary" size="default">
        Default
      </Button>
      <Button variant="primary" size="large">
        Large
      </Button>
    </div>
  ),
  description: "All sizes side by side",
  tags: ["composite"],
};

export const AllVariants: OrgiiProject<ButtonProps> = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="tertiary">Tertiary</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="warning">Warning</Button>
      <Button variant="success">Success</Button>
    </div>
  ),
  description: "All variants in their default appearance",
  tags: ["composite"],
};

export const AllAppearances: OrgiiProject<ButtonProps> = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
      <Button variant="primary" appearance="solid">
        Solid
      </Button>
      <Button variant="primary" appearance="outline">
        Outline
      </Button>
      <Button variant="primary" appearance="dashed">
        Dashed
      </Button>
      <Button variant="primary" appearance="ghost">
        Ghost
      </Button>
    </div>
  ),
  description: "All appearances of `variant=primary`",
  tags: ["composite"],
};

export const DangerAppearances: OrgiiProject<ButtonProps> = {
  render: () => (
    <div style={{ display: "flex", gap: "8px" }}>
      <Button variant="danger" appearance="solid">
        Delete
      </Button>
      <Button variant="danger" appearance="outline">
        Delete
      </Button>
      <Button variant="danger" appearance="ghost">
        Delete
      </Button>
    </div>
  ),
  description: "Destructive action across appearances",
  tags: ["composite"],
};
