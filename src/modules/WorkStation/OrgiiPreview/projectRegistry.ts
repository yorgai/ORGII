import type { ComponentType } from "react";

/**
 * Project Registry - Auto-discover all .orgii.tsx files at build time
 *
 * Uses webpack's require.context to automatically find and register
 * all project files without hardcoding paths.
 *
 * This works for files within the webpack build context (src/).
 * For external repos, a different approach (bundler service) is needed.
 */

// ============================================
// Types
// ============================================

export interface ProjectModule {
  default: {
    title: string;
    component: ComponentType<unknown>;
    args?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export interface RegisteredProject {
  /** Relative path from src/ */
  path: string;
  /** Project module exports */
  module: ProjectModule;
  /** The component to render */
  component: ComponentType<unknown>;
}

// ============================================
// Registry
// ============================================

const registeredProjects = new Map<string, RegisteredProject>();

/**
 * Register a project module
 */
export function registerProject(
  path: string,
  moduleExports: ProjectModule
): boolean {
  try {
    const meta = moduleExports.default;
    if (!meta?.component) {
      console.warn(`[ProjectRegistry] No component in ${path}`);
      return false;
    }

    const Component = meta.component;
    const isValidComponent =
      Component &&
      (typeof Component === "function" ||
        (typeof Component === "object" &&
          Component !== null &&
          "$$typeof" in Component));

    if (!isValidComponent) {
      console.warn(`[ProjectRegistry] Invalid component in ${path}`);
      return false;
    }

    registeredProjects.set(path, {
      path,
      module: moduleExports,
      component: Component,
    });

    return true;
  } catch (error) {
    console.error(`[ProjectRegistry] Failed to register ${path}:`, error);
    return false;
  }
}

/**
 * Get a registered project by path
 */
export function getProject(path: string): RegisteredProject | undefined {
  // Try exact match
  const project = registeredProjects.get(path);
  if (project) return project;

  // Try partial match (path contains key or key contains path)
  for (const [key, value] of registeredProjects.entries()) {
    if (path.includes(key) || key.includes(path)) {
      return value;
    }
  }

  // Try matching by component folder name
  const folderMatch = path.match(/components\/([^/]+)/);
  if (folderMatch) {
    const componentName = folderMatch[1];
    for (const [key, value] of registeredProjects.entries()) {
      if (
        key.includes(`/${componentName}/`) ||
        key.includes(`/${componentName}.`)
      ) {
        return value;
      }
    }
  }

  return undefined;
}

/**
 * Get all registered project paths
 */
export function getRegisteredPaths(): string[] {
  return Array.from(registeredProjects.keys());
}

/**
 * Get project count
 */
export function getProjectCount(): number {
  return registeredProjects.size;
}

// ============================================
// Auto-discovery using require.context
// ============================================

// Webpack-specific: Declare require.context
declare const require: {
  context: (
    directory: string,
    useSubdirectories: boolean,
    regExp: RegExp
  ) => {
    keys: () => string[];
    (id: string): unknown;
  };
};

/**
 * Auto-discover and register all .orgii.tsx files
 */
export function autoDiscoverProjects(): void {
  try {
    // Use require.context to find all .orgii.tsx files in src/
    // This is evaluated at build time by webpack
    const projectContext = require.context(
      "../../../", // Start from src/ (three levels up from OrgiiPreview/)
      true, // Include subdirectories
      /\.orgii\.tsx?$/ // Match .orgii.ts and .orgii.tsx files
    );

    const paths = projectContext.keys();

    for (const path of paths) {
      try {
        const moduleExports = projectContext(path) as ProjectModule;
        const cleanPath = path
          .replace(/^\.\//, "")
          .replace(/\.orgii\.tsx?$/, "");

        registerProject(cleanPath, moduleExports);
      } catch (error) {
        console.warn(`[ProjectRegistry] Failed to load ${path}:`, error);
      }
    }
  } catch {
    // Expected if no .orgii.tsx files exist
  }
}

// Auto-run discovery on module load
autoDiscoverProjects();

// Export registry for debugging
export { registeredProjects };
