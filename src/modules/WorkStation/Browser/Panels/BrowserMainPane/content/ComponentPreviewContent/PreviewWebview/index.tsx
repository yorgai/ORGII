/**
 * PreviewWebview - Live component preview using Tauri webview
 * Creates a native webview overlay positioned on top of this container
 */
import React, { memo, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useOrgiiPreview } from "@src/modules/WorkStation/Browser/hooks/useOrgiiPreview";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

import type { PreviewWebviewProps } from "../types";

export const PreviewWebview: React.FC<PreviewWebviewProps> = memo(
  ({ componentName, componentPath, projectName, propValues, repoPath }) => {
    const { t } = useTranslation();
    const containerRef = React.useRef<HTMLDivElement>(null);
    const preview = useOrgiiPreview();
    const hasLoadedRef = React.useRef(false);
    const lastComponentRef = React.useRef<string | null>(null);
    const lastStylesLoadedRef = React.useRef<string | null>(null);

    // Store preview functions in refs to avoid re-render loops
    const previewRef = React.useRef(preview);
    useEffect(() => {
      previewRef.current = preview;
    }, [preview]);

    // Create webview and position it over this container (run once)
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      // Get container bounds relative to window
      const updateBounds = () => {
        const rect = container.getBoundingClientRect();
        return {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
      };

      const initPreview = async () => {
        const bounds = updateBounds();
        const preview = previewRef.current;

        if (!preview.isCreated) {
          await preview.create(bounds);
        } else {
          await preview.updatePosition(bounds);
          await preview.show();
        }
      };

      initPreview();

      // Update position on resize
      const resizeObserver = new ResizeObserver(() => {
        const preview = previewRef.current;
        if (preview.isCreated) {
          const bounds = updateBounds();
          preview.updatePosition(bounds);
        }
      });
      resizeObserver.observe(container);

      // Cleanup: hide webview when component unmounts
      return () => {
        resizeObserver.disconnect();
        const preview = previewRef.current;
        if (preview.isCreated) {
          preview.hide();
        }
      };
    }, []); // Run once on mount

    // Track propValues in a ref to avoid triggering effect on reference changes
    const propValuesForLoadRef = React.useRef(propValues);
    useEffect(() => {
      propValuesForLoadRef.current = propValues;
    }, [propValues]);

    // Load component when webview is created
    useEffect(() => {
      if (!preview.isCreated) return;

      const componentKey = `${componentPath}:${componentName}:${projectName}`;

      // Only load if component changed or not loaded yet
      if (lastComponentRef.current !== componentKey || !hasLoadedRef.current) {
        // Small delay to ensure the webview's React app is mounted
        const timer = setTimeout(() => {
          previewRef.current.loadComponent(
            componentPath,
            componentName,
            propValuesForLoadRef.current,
            projectName ?? undefined
          );
        }, 300);

        lastComponentRef.current = componentKey;
        hasLoadedRef.current = true;

        return () => clearTimeout(timer);
      }
    }, [
      preview.isCreated,
      componentPath,
      componentName,
      projectName,
      // Note: propValues intentionally omitted - use ref to avoid re-triggering on reference changes
      // Prop updates are handled by the separate useEffect below
    ]);

    // Load component styles (SCSS/CSS) when component changes
    useEffect(() => {
      if (!preview.isCreated) return;
      if (!repoPath) return;

      // Only load styles if component changed
      const stylesKey = `${repoPath}:${componentPath}`;
      if (lastStylesLoadedRef.current === stylesKey) return;

      // Load styles after a small delay (after component load starts)
      const timer = setTimeout(() => {
        previewRef.current.loadComponentStyles(repoPath, componentPath);
        lastStylesLoadedRef.current = stylesKey;
      }, 400);

      return () => clearTimeout(timer);
    }, [preview.isCreated, repoPath, componentPath]);

    // Update args when props change (but not on initial load)
    const propValuesRef = React.useRef(propValues);
    useEffect(() => {
      // Skip if this is the first render or component not loaded
      if (!hasLoadedRef.current) return;
      if (preview.state.status !== "ready") return;

      // Only update if propValues actually changed (deep compare would be better)
      const prevJson = JSON.stringify(propValuesRef.current);
      const currJson = JSON.stringify(propValues);
      if (prevJson !== currJson) {
        propValuesRef.current = propValues;
        previewRef.current.setArgs(propValues);
      }
    }, [preview.state.status, propValues]);

    // The container div defines where the webview will be positioned
    return (
      <div
        ref={containerRef}
        className="h-full w-full bg-white"
        style={{ minHeight: 200 }}
      >
        {/* Webview renders on top of this div */}
        {preview.state.status === "loading" && (
          <Placeholder
            variant="loading"
            title={`Loading ${componentName}...`}
          />
        )}
        {preview.state.status === "error" && (
          <Placeholder
            variant="error"
            title={t("placeholders.failedToLoadComponent")}
            subtitle={preview.state.error || preview.error || undefined}
            action={{
              label: "Retry",
              onClick: () => {
                // Reset state and re-trigger component load
                hasLoadedRef.current = false;
                lastComponentRef.current = null;
                // Use ref for current propValues to avoid stale closure
                previewRef.current.loadComponent(
                  componentPath,
                  componentName,
                  propValuesForLoadRef.current,
                  projectName ?? undefined
                );
              },
            }}
          />
        )}
        {!preview.isCreated && preview.state.status === "not_ready" && (
          <Placeholder
            variant="loading"
            title={t("workstation.initializingPreview")}
          />
        )}
      </div>
    );
  }
);

PreviewWebview.displayName = "PreviewWebview";
