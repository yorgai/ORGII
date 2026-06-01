/**
 * Hooks Index
 *
 * Centralized exports for all custom hooks organized by category.
 * All hooks have been reorganized into logical categories for better maintainability.
 */

// ============================================
// Async Data Utilities
// ============================================
export * from "./async";

// ============================================
// Session Management
// ============================================
export * from "@src/engines/SessionCore/hooks";

// ============================================
// Workflow Management
// ============================================
// Note: workflow hooks removed - module does not exist

// ============================================
// Git Operations
// ============================================
export * from "./git";

// ============================================
// Workstation (Editor, Database, Browser)
// ============================================
export * from "./workStation";

// ============================================
// UI Components
// ============================================
export * from "./ui";

// ============================================
// Theme & Visual
// ============================================
export * from "./theme";

// ============================================
// Skills hub / editor (Tauri — not marketplace UI)
// ============================================
export * from "./skills";

// ============================================
// Configuration & Settings
// ============================================
export * from "./config";

// ============================================
// Navigation & Shortcuts
// ============================================
export * from "./navigation";

// ============================================
// Keyboard Utilities
// ============================================
export * from "./keyboard";

// ============================================
// Search & Filtering
// ============================================
export * from "./search";

// ============================================
// Platform Integration
// ============================================
export * from "./platform";

// ============================================
// Activity Simulator
// ============================================
// Note: simulator hooks removed - module does not exist

// ============================================
// Dropdown Utilities
// ============================================
export * from "./dropdown";

// ============================================
// Performance Monitoring
// ============================================
export * from "./perf";

// ============================================
// Flow Awareness (User Activity Tracking)
// ============================================
export * from "./flowAwareness";
