/**
 * Sidebar Variants
 *
 * All composed sidebar components in one place.
 */

// ============================================
// Base Composed Sidebars
// ============================================
export { default as NavigationSidebar } from "./NavigationSidebar";

// ============================================
// Page-Specific Sidebars
// ============================================
export { default as HomeSidebar } from "./HomeSidebar";
export { default as PageLevelSidebar } from "./PageLevelSidebar";
export type {
  PageLevelSidebarItem,
  PageLevelSidebarProps,
} from "./PageLevelSidebar";

// ============================================
// Type Re-exports
// ============================================
export type { NavigationSidebarProps } from "./NavigationSidebar";
