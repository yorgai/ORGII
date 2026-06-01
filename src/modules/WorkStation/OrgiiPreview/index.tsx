/**
 * ORGII Preview Entry Point - UNIVERSAL
 *
 * Standalone page for rendering component previews in a Tauri webview.
 * Auto-discovers all .orgii.tsx files in the build via webpack's require.context.
 *
 * How it works:
 * 1. At build time, webpack scans for all .orgii.tsx files
 * 2. Projects are auto-registered in projectRegistry.ts
 * 3. Rust calls __ORGII_LOAD_COMPONENT__ with component path
 * 4. This page looks up the project and renders
 * 5. Tokens are injected via __ORGII_INJECT_CSS__
 *
 * No hardcoded imports - projects are discovered automatically!
 *
 * @see Documentation/WorkStation/code-editor/orgii-project-format--0130.md
 */
import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

// Only preview-specific styles (tokens provide all CSS variables!)
import "./index.scss";
// Auto-discover and register all .orgii.tsx files at build time
import {
  type ProjectModule,
  getProject,
  getRegisteredPaths,
  registerProject as registryRegisterProject,
} from "./projectRegistry";

// ============================================
// Types
// ============================================

interface PreviewState {
  status: "idle" | "loading" | "ready" | "error";
  componentPath: string | null;
  componentName: string | null;
  projectName: string | null;
  Component: React.ComponentType<Record<string, unknown>> | null;
  renderFn: (() => React.ReactNode) | null;
  args: Record<string, unknown>;
  error: string | null;
}

// ============================================
// Helper Functions (using projectRegistry)
// ============================================

/**
 * Get a component from the registry
 */
function getComponent(
  componentPath: string
): React.ComponentType<unknown> | null {
  const project = getProject(componentPath);
  return project?.component ?? null;
}

/**
 * Project object type
 */
interface ProjectObject {
  args?: Record<string, unknown>;
  render?: () => React.ReactNode;
}

/**
 * Get project args by export name
 */
function getProjectArgs(
  componentPath: string,
  projectName: string
): Record<string, unknown> {
  const projectEntry = getProject(componentPath);
  if (!projectEntry) return {};

  const mod = projectEntry.module;
  const project = mod[projectName] as ProjectObject | undefined;
  const defaultMeta = mod.default;

  return {
    ...(defaultMeta?.args || {}),
    ...(project?.args || {}),
  };
}

/**
 * Get project render function if it exists
 */
function getProjectRender(
  componentPath: string,
  projectName: string
): (() => React.ReactNode) | null {
  const projectEntry = getProject(componentPath);
  if (!projectEntry) return null;

  const mod = projectEntry.module;
  const project = mod[projectName] as ProjectObject | undefined;

  return project?.render ?? null;
}

/**
 * Get all project names for a component path
 */
function getProjectNames(componentPath: string): string[] {
  const projectEntry = getProject(componentPath);
  if (!projectEntry) return [];

  return Object.keys(projectEntry.module).filter(
    (key) =>
      key !== "default" &&
      typeof projectEntry.module[key] === "object" &&
      projectEntry.module[key] !== null
  );
}

/**
 * Register a project at runtime (for external projects sent via Rust)
 */
function registerRuntimeProject(
  path: string,
  moduleCode: ProjectModule
): { success: boolean; error?: string } {
  try {
    const success = registryRegisterProject(path, moduleCode);
    return { success };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// ============================================
// Preview App
// ============================================

function PreviewApp() {
  const [state, setState] = useState<PreviewState>({
    status: "idle",
    componentPath: null,
    componentName: null,
    projectName: null,
    Component: null,
    renderFn: null,
    args: {},
    error: null,
  });

  /**
   * Load a component for preview
   */
  const loadComponent = useCallback(
    (
      componentPath: string,
      componentName: string,
      projectName: string | null,
      initialArgs: Record<string, unknown>
    ) => {
      setState((prev) => ({
        ...prev,
        status: "loading",
        componentPath,
        componentName,
        projectName,
        args: initialArgs,
        error: null,
      }));

      try {
        // Get component from registry
        const Component = getComponent(componentPath);

        if (!Component) {
          const registered = getRegisteredPaths();
          throw new Error(
            `Component not found: ${componentPath}\n` +
              `Registered: ${registered.join(", ") || "none"}\n` +
              `Make sure you have a .orgii.tsx file for this component`
          );
        }

        // Get project render function if it exists
        const renderFn = projectName
          ? getProjectRender(componentPath, projectName)
          : null;

        // Get project args if a project is specified
        const projectArgs = projectName
          ? getProjectArgs(componentPath, projectName)
          : {};

        // Merge initial args with project args
        const mergedArgs = { ...projectArgs, ...initialArgs };

        setState((prev) => ({
          ...prev,
          status: "ready",
          Component: Component as React.ComponentType<Record<string, unknown>>,
          renderFn,
          args: mergedArgs,
        }));

        // Notify that component is loaded
        (window as unknown as Record<string, unknown>).__ORGII_READY__ = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[ORGII Preview] Failed to load component:", message);

        setState((prev) => ({
          ...prev,
          status: "error",
          error: message,
        }));
      }
    },
    []
  );

  /**
   * Update args (props) for the current component
   */
  const updateArgs = useCallback((newArgs: Record<string, unknown>) => {
    setState((prev) => ({
      ...prev,
      args: { ...prev.args, ...newArgs },
    }));
  }, []);

  /**
   * Replace all args
   */
  const setArgs = useCallback((args: Record<string, unknown>) => {
    setState((prev) => ({
      ...prev,
      args,
    }));
  }, []);

  /**
   * Reset preview to idle state
   */
  const reset = useCallback(() => {
    setState({
      status: "idle",
      componentPath: null,
      componentName: null,
      projectName: null,
      Component: null,
      renderFn: null,
      args: {},
      error: null,
    });
    (window as unknown as Record<string, unknown>).__ORGII_READY__ = false;
  }, []);

  // Expose functions to window for Rust eval() calls
  useEffect(() => {
    const windowAny = window as unknown as Record<string, unknown>;

    // Register a project module at runtime (for external projects)
    windowAny.__ORGII_REGISTER_STORY__ = (
      path: unknown,
      moduleCode: unknown
    ) => {
      return registerRuntimeProject(
        path as string,
        moduleCode as ProjectModule
      );
    };

    // Get project names for a component (for debugging)
    windowAny.__ORGII_GET_STORIES__ = (componentPath: unknown) => {
      return getProjectNames(componentPath as string);
    };

    // Get all registered project paths
    windowAny.__ORGII_GET_REGISTERED__ = () => {
      return getRegisteredPaths();
    };

    // Load a component for preview
    windowAny.__ORGII_LOAD_COMPONENT__ = (
      componentPath: unknown,
      componentName: unknown,
      projectName: unknown,
      args: unknown
    ) => {
      loadComponent(
        componentPath as string,
        componentName as string,
        projectName as string | null,
        (args as Record<string, unknown>) || {}
      );
    };

    // Update props
    windowAny.__ORGII_UPDATE_ARGS__ = (args: unknown) => {
      updateArgs(args as Record<string, unknown>);
    };

    // Set all props
    windowAny.__ORGII_SET_ARGS__ = (args: unknown) => {
      setArgs(args as Record<string, unknown>);
    };

    // Reset preview
    windowAny.__ORGII_RESET__ = reset;

    // Inject CSS tokens (global design tokens)
    windowAny.__ORGII_INJECT_CSS__ = (css: unknown) => {
      const cssString = css as string;
      let styleEl = document.getElementById("orgii-injected-tokens");
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "orgii-injected-tokens";
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = cssString;
    };

    // Inject component styles (SCSS/CSS rules - separate from tokens)
    windowAny.__ORGII_INJECT_COMPONENT_CSS__ = (css: unknown) => {
      const cssString = css as string;
      let styleEl = document.getElementById("orgii-injected-component-styles");
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "orgii-injected-component-styles";
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = cssString;
    };

    // Getter for current state
    Object.defineProperty(window, "__ORGII_STATE__", {
      get: () => ({
        status: state.status,
        componentPath: state.componentPath,
        componentName: state.componentName,
        projectName: state.projectName,
        args: state.args,
        error: state.error,
        registeredProjects: getRegisteredPaths(),
      }),
      configurable: true,
    });

    return () => {
      delete windowAny.__ORGII_REGISTER_STORY__;
      delete windowAny.__ORGII_GET_STORIES__;
      delete windowAny.__ORGII_GET_REGISTERED__;
      delete windowAny.__ORGII_LOAD_COMPONENT__;
      delete windowAny.__ORGII_UPDATE_ARGS__;
      delete windowAny.__ORGII_SET_ARGS__;
      delete windowAny.__ORGII_RESET__;
      delete windowAny.__ORGII_INJECT_CSS__;
      delete windowAny.__ORGII_INJECT_COMPONENT_CSS__;
    };
  }, [loadComponent, updateArgs, setArgs, reset, state]);

  // Render based on status
  if (state.status === "idle") {
    // Empty state - just wait for component to load
    return <div className="orgii-preview orgii-preview--idle" />;
  }

  if (state.status === "loading") {
    return (
      <div className="orgii-preview orgii-preview--loading">
        <div className="orgii-preview__spinner" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="orgii-preview orgii-preview--error">
        <div className="orgii-preview__message">
          <div className="orgii-preview__icon">⚠️</div>
          <div className="orgii-preview__title">Failed to load component</div>
          <pre className="orgii-preview__error">{state.error}</pre>
          <button
            className="orgii-preview__retry"
            onClick={() => {
              // Retry loading the same component
              if (state.componentPath && state.componentName) {
                loadComponent(
                  state.componentPath,
                  state.componentName,
                  state.projectName,
                  state.args
                );
              }
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Ready - render the component
  const { Component, renderFn, args } = state;

  if (!Component && !renderFn) {
    return null;
  }

  return (
    <div className="orgii-preview orgii-preview--ready">
      <div className="orgii-preview__canvas">
        <React.Suspense
          fallback={
            <div className="orgii-preview__suspense">Loading component...</div>
          }
        >
          <ErrorBoundary
            fallback={(error) => (
              <div className="orgii-preview__render-error">
                <div className="orgii-preview__icon">💥</div>
                <div className="orgii-preview__title">Render Error</div>
                <pre className="orgii-preview__error">{error.message}</pre>
              </div>
            )}
          >
            {/* Stable wrapper to prevent layout shifts from dropdowns/tooltips */}
            <div className="orgii-preview__component">
              {renderFn ? renderFn() : Component && <Component {...args} />}
            </div>
          </ErrorBoundary>
        </React.Suspense>
      </div>
    </div>
  );
}

// ============================================
// Error Boundary
// ============================================

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback: (error: Error) => React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ORGII Preview] Render error:", error, info);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error);
    }
    return this.props.children;
  }
}

// ============================================
// Mount
// ============================================

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <PreviewApp />
    </React.StrictMode>
  );
}
