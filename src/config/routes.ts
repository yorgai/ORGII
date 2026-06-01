/**
 * Centralized Route Constants
 *
 * Single source of truth for all application routes.
 * Each route includes:
 * - path: The actual route path
 * - label: Display label (static or dynamic)
 * - viewMode: Which view mode this route belongs to
 * - tabType: Associated tab type for singleton/behavior rules
 * - icon: Icon name for this route
 *
 * Structure:
 * - /orgii/workstation/*   - Workstation View Mode (Code Editor, Database Manager, Browser)
 * - /orgii/app/*          - App View Mode (organized by functional domains)
 */
import type { LucideIcon } from "lucide-react";

import { ICON_NAME_MAP } from "./iconMapping";
// Route group constants — imported for use below and re-exported for consumers
import {
  APP_HOME_ROUTES,
  APP_IDEA_ROUTES,
  APP_JOURNEY_ROUTES,
  APP_MARKET_ROUTES,
  APP_SETTINGS_ROUTE,
  AUTH_ROUTES,
  WORK_STATION_ROUTES,
} from "./routeGroups";
// Import shared types from mapping module (breaks circular dependency)
import type { RouteInfo, RouteLabelContext } from "./routeTabMapping";
import type { ViewModeType } from "./viewModeTypes";

// Re-export for convenience
export type { RouteLabelContext, RouteInfo };

export {
  APP_HOME_ROUTES,
  APP_IDEA_ROUTES,
  APP_JOURNEY_ROUTES,
  APP_MARKET_ROUTES,
  APP_SETTINGS_ROUTE,
  AUTH_ROUTES,
  WORK_STATION_ROUTES,
};

// ============================================================================
// UNIFIED ROUTE OBJECT
// All routes in one place for easy access
// ============================================================================

export const ROUTES = {
  workStation: WORK_STATION_ROUTES,
  auth: AUTH_ROUTES,
  app: {
    home: APP_HOME_ROUTES,
    settings: APP_SETTINGS_ROUTE,
    journey: APP_JOURNEY_ROUTES,
    ideas: APP_IDEA_ROUTES,
    market: APP_MARKET_ROUTES,
  },
} as const;

// ============================================================================
// ROUTE LOOKUP HELPERS
// ============================================================================

/**
 * Get the path from a RouteInfo object
 * Handles both static routes and dynamic route functions
 */
export function getRoutePath(routeInfo: RouteInfo | string): string {
  if (typeof routeInfo === "string") return routeInfo;
  return routeInfo.path;
}

/**
 * Get label from a RouteInfo, resolving dynamic labels
 */
export function getRouteLabel(
  routeInfo: RouteInfo,
  context: RouteLabelContext = {}
): string {
  if (typeof routeInfo.label === "function") {
    return routeInfo.label(context);
  }
  return routeInfo.label;
}

/**
 * Collect all static RouteInfo objects for lookup
 * (Excludes function-based dynamic routes like workspaceWithId)
 */
function collectAllRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];

  // Helper to recursively collect routes
  function collect(obj: Record<string, unknown>) {
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object" && "path" in value) {
        routes.push(value as RouteInfo);
      } else if (value && typeof value === "object" && !("path" in value)) {
        // Nested object, recurse (but skip functions)
        if (typeof value !== "function") {
          collect(value as Record<string, unknown>);
        }
      }
    }
  }

  collect(ROUTES);
  return routes;
}

/** All static routes for lookup */
export const ALL_ROUTES = collectAllRoutes();

/**
 * Find route info by path
 */
export function findRouteByPath(path: string): RouteInfo | undefined {
  // Exact match first
  const exact = ALL_ROUTES.find((route) => route.path === path);
  if (exact) return exact;

  // Pattern match (for :param routes)
  for (const routeInfo of ALL_ROUTES) {
    if (matchRoutePath(path, routeInfo.path)) {
      return routeInfo;
    }
  }

  return undefined;
}

/**
 * Match a path against a pattern (supports :param)
 */
export function matchRoutePath(path: string, pattern: string): boolean {
  if (path === pattern) return true;

  const patternParts = pattern.split("/");
  const pathParts = path.split("/");

  if (patternParts.length !== pathParts.length) return false;

  for (let index = 0; index < patternParts.length; index++) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];

    if (patternPart.startsWith(":")) continue;
    if (patternPart !== pathPart) return false;
  }

  return true;
}

/**
 * Extract params from a path using a pattern
 */
export function extractRouteParams(
  path: string,
  pattern: string
): Record<string, string> {
  const params: Record<string, string> = {};
  const patternParts = pattern.split("/");
  const pathParts = path.split("/");

  for (let index = 0; index < patternParts.length; index++) {
    const patternPart = patternParts[index];
    if (patternPart.startsWith(":")) {
      const paramName = patternPart.slice(1);
      params[paramName] = pathParts[index] || "";
    }
  }

  return params;
}

/**
 * Get view mode for a path
 */
export function getViewModeForPath(path: string): ViewModeType {
  const routeInfo = findRouteByPath(path);
  return routeInfo?.viewMode ?? "mainApp";
}

/**
 * Get tab type for a path
 */
export function getTabTypeForPath(path: string): string {
  const routeInfo = findRouteByPath(path);
  return routeInfo?.tabType ?? "app";
}

/**
 * Get label for a path (with optional context for dynamic labels)
 */
export function getLabelForPath(
  path: string,
  context: RouteLabelContext = {}
): string {
  const routeInfo = findRouteByPath(path);
  if (!routeInfo) return "Unknown";
  return getRouteLabel(routeInfo, context);
}

/**
 * Get icon name for a path
 */
export function getIconForPath(path: string): string | undefined {
  const routeInfo = findRouteByPath(path);
  return routeInfo?.icon;
}

/**
 * Get icon component for a path
 */
export function getIconComponentForPath(path: string): LucideIcon | null {
  const iconName = getIconForPath(path);
  if (!iconName) return null;
  return ICON_NAME_MAP[iconName] ?? null;
}

// ============================================================================
// TAB TYPE HELPERS
// Derive info from routes for tab types
// ============================================================================

// Note: getViewModeForTabType and getCategoryForTabType are imported from routeTabMapping.ts

/**
 * Get primary route path for a tab type (non-pattern preferred)
 */
export function getPrimaryRouteForTabType(tabType: string): string | undefined {
  const routes = ALL_ROUTES.filter((route) => route.tabType === tabType);
  const staticRoute = routes.find((route) => !route.path.includes(":"));
  return staticRoute?.path ?? routes[0]?.path;
}

// ============================================================================
// VIEW MODE MAPPING - Import from mapping module
// ============================================================================

export { getViewModeForTabType } from "./routeTabMapping";
