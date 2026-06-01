/**
 * Breadcrumb Projects
 *
 * Showcases Breadcrumb component variants, patterns, and edge cases.
 * Used for isolated development, visual testing, and AI context.
 *
 * @see Documentation/Architecture-Guide/orgii-editor/orgii-project-format-0130.md
 */
import type { OrgiiMeta, OrgiiProject } from "@/src/types/orgii_preview";
import { Folder, Home, Settings } from "lucide-react";

import Breadcrumb, { type BreadcrumbProps } from "./index";

// ============================================
// Meta Configuration
// ============================================

const meta: OrgiiMeta<BreadcrumbProps> = {
  component: Breadcrumb,
  title: "Components/Breadcrumb",
  description:
    "Native breadcrumb navigation with items prop or Breadcrumb.Item children pattern. Supports custom separators, truncation, and icons.",
  args: {},
  argTypes: {
    separator: {
      control: "text",
      description: "Custom separator between items (ReactNode)",
    },
    maxCount: {
      control: "number",
      description: "Maximum items to show before truncating with ellipsis",
    },
    className: {
      control: "text",
      description: "Additional CSS class",
    },
  },
  tags: ["navigation", "core"],
};

export default meta;

// ============================================
// Basic Usage (Items Prop)
// ============================================

export const Default: OrgiiProject<BreadcrumbProps> = {
  args: {
    items: [{ label: "Home", link: "/" }, { label: "Products" }],
  },
  description: "Basic breadcrumb with two items",
};

export const ThreeItems: OrgiiProject<BreadcrumbProps> = {
  name: "Three Items",
  args: {
    items: [
      { label: "Home", link: "/" },
      { label: "Products", link: "/products" },
      { label: "Electronics" },
    ],
  },
  description: "Standard three-level navigation",
};

export const WithIcons: OrgiiProject<BreadcrumbProps> = {
  args: {
    items: [
      { label: "Home", link: "/", icon: <Home size={14} /> },
      { label: "Documents", link: "/docs", icon: <Folder size={14} /> },
      { label: "Settings", icon: <Settings size={14} /> },
    ],
  },
  description: "Breadcrumb items with leading icons",
  tags: ["icon"],
};

export const WithCallback: OrgiiProject<BreadcrumbProps> = {
  args: {
    items: [
      { label: "Home", callback: () => {} },
      {
        label: "Settings",
        callback: () => {},
      },
      { label: "Profile" },
    ],
  },
  description: "Using callback functions instead of links",
};

// ============================================
// Children Pattern (Breadcrumb.Item)
// ============================================

export const ChildrenPattern: OrgiiProject<BreadcrumbProps> = {
  render: () => (
    <Breadcrumb>
      <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
      <Breadcrumb.Item href="/products">Products</Breadcrumb.Item>
      <Breadcrumb.Item>Current Page</Breadcrumb.Item>
    </Breadcrumb>
  ),
  description: "Using Breadcrumb.Item children instead of items prop",
  tags: ["pattern"],
};

export const ChildrenWithClick: OrgiiProject<BreadcrumbProps> = {
  name: "Children with onClick",
  render: () => (
    <Breadcrumb>
      <Breadcrumb.Item onClick={() => {}}>Home</Breadcrumb.Item>
      <Breadcrumb.Item onClick={() => {}}>Products</Breadcrumb.Item>
      <Breadcrumb.Item>Current</Breadcrumb.Item>
    </Breadcrumb>
  ),
  description: "Breadcrumb.Item with onClick handlers",
  tags: ["pattern"],
};

// ============================================
// Custom Separator
// ============================================

export const SlashSeparator: OrgiiProject<BreadcrumbProps> = {
  args: {
    separator: "/",
    items: [
      { label: "Home", link: "/" },
      { label: "Products", link: "/products" },
      { label: "Details" },
    ],
  },
  description: "Using slash as separator",
  tags: ["separator"],
};

export const ArrowSeparator: OrgiiProject<BreadcrumbProps> = {
  args: {
    separator: "→",
    items: [
      { label: "Start", link: "/" },
      { label: "Middle", link: "/middle" },
      { label: "End" },
    ],
  },
  description: "Using arrow as separator",
  tags: ["separator"],
};

export const CustomNodeSeparator: OrgiiProject<BreadcrumbProps> = {
  name: "Custom Node Separator",
  args: {
    separator: <span className="mx-1 text-primary-6">•</span>,
    items: [
      { label: "Home", link: "/" },
      { label: "Category", link: "/category" },
      { label: "Item" },
    ],
  },
  description: "Using custom React node as separator",
  tags: ["separator"],
};

// ============================================
// Truncation (maxCount)
// ============================================

export const Truncated: OrgiiProject<BreadcrumbProps> = {
  args: {
    maxCount: 3,
    items: [
      { label: "Home", link: "/" },
      { label: "Level 1", link: "/l1" },
      { label: "Level 2", link: "/l2" },
      { label: "Level 3", link: "/l3" },
      { label: "Level 4", link: "/l4" },
      { label: "Current Page" },
    ],
  },
  description: "Long path truncated with ellipsis (maxCount=3)",
  tags: ["truncation"],
};

export const TruncatedChildren: OrgiiProject<BreadcrumbProps> = {
  name: "Truncated (Children Pattern)",
  render: () => (
    <Breadcrumb maxCount={3}>
      <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
      <Breadcrumb.Item href="/a">Level A</Breadcrumb.Item>
      <Breadcrumb.Item href="/b">Level B</Breadcrumb.Item>
      <Breadcrumb.Item href="/c">Level C</Breadcrumb.Item>
      <Breadcrumb.Item href="/d">Level D</Breadcrumb.Item>
      <Breadcrumb.Item>Current</Breadcrumb.Item>
    </Breadcrumb>
  ),
  description: "Truncation with Breadcrumb.Item children",
  tags: ["truncation"],
};

// ============================================
// Edge Cases
// ============================================

export const SingleItem: OrgiiProject<BreadcrumbProps> = {
  args: {
    items: [{ label: "Home" }],
  },
  description: "Single breadcrumb item (no separator shown)",
  tags: ["edge-case"],
};

export const LongLabels: OrgiiProject<BreadcrumbProps> = {
  args: {
    items: [
      { label: "Home", link: "/" },
      { label: "This is a very long category name", link: "/category" },
      { label: "Another extremely long page title here" },
    ],
  },
  description: "Tests handling of long text labels",
  tags: ["edge-case"],
};

export const ManyItems: OrgiiProject<BreadcrumbProps> = {
  args: {
    items: [
      { label: "Root", link: "/" },
      { label: "Level 1", link: "/1" },
      { label: "Level 2", link: "/2" },
      { label: "Level 3", link: "/3" },
      { label: "Level 4", link: "/4" },
      { label: "Level 5", link: "/5" },
      { label: "Level 6", link: "/6" },
      { label: "Level 7", link: "/7" },
      { label: "Current" },
    ],
  },
  description: "Deep navigation without truncation (consider using maxCount)",
  tags: ["edge-case"],
};

export const EmptyItems: OrgiiProject<BreadcrumbProps> = {
  args: {
    items: [],
  },
  description: "Empty items array (renders nothing)",
  tags: ["edge-case"],
};

// ============================================
// Composite Examples
// ============================================

export const AllPatterns: OrgiiProject<BreadcrumbProps> = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Items prop */}
      <Breadcrumb
        items={[
          { label: "Home", link: "/" },
          { label: "Products", link: "/products" },
          { label: "Current" },
        ]}
      />

      {/* Children pattern */}
      <Breadcrumb>
        <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
        <Breadcrumb.Item href="/docs">Documentation</Breadcrumb.Item>
        <Breadcrumb.Item>Guide</Breadcrumb.Item>
      </Breadcrumb>

      {/* Custom separator */}
      <Breadcrumb
        separator="/"
        items={[
          { label: "root", link: "/" },
          { label: "folder", link: "/folder" },
          { label: "file.txt" },
        ]}
      />
    </div>
  ),
  description: "All breadcrumb patterns side by side",
  tags: ["composite"],
};

export const WithViewMode: OrgiiProject<BreadcrumbProps> = {
  args: {
    items: [
      { label: "Dashboard", link: "/dashboard", viewMode: "dashboard" },
      { label: "Users", link: "/users", viewMode: "table" },
      { label: "User Details" },
    ],
  },
  description: "Navigation with viewMode state passed to router",
  tags: ["advanced"],
};
