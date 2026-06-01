/**
 * ComponentPreviewPanel - Renders a React component preview
 *
 * This panel displays:
 * 1. Component info header (name, file, line)
 * 2. Props editor panel (editable controls for each prop)
 * 3. Live preview of the component rendered in an iframe
 *
 * Part of "Storybook for AI" feature:
 * - User clicks component in Repo Components sidebar
 * - Component opens in this preview panel
 * - Props are extracted and displayed as editable controls
 * - Preview updates live as props change
 */
import { useAtomValue } from "jotai";
import { Code2, ExternalLink, RefreshCw } from "lucide-react";
import {
  type ChangeEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { useDesignTokens } from "@src/modules/WorkStation/Browser/hooks/useDesignTokens";
import {
  HEADER_BUTTON,
  HEADER_CLASSES,
  HEADER_ICON_SIZE,
} from "@src/modules/WorkStation/shared/tokens";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { tokenCSSAtom } from "@src/store/workstation/browser/tokens/tokenAtoms";

import { PreviewWebview } from "./PreviewWebview";
import { PropsPanel } from "./PropsPanel";
import { TokensPanel } from "./TokensPanel";
import type { ComponentPreviewPanelProps, ProjectInfo } from "./types";

export const ComponentPreviewPanel = memo<ComponentPreviewPanelProps>(
  ({
    preview,
    details,
    projectFile,
    selectedProject,
    onSelectProject,
    isLoading,
    onOpenSource,
    onRefresh,
    repoPath,
  }) => {
    const { t } = useTranslation();
    // Track user's explicit project selection with the projectFile it belongs to
    // This invalidates automatically when projectFile changes
    const [userProjectSelection, setUserProjectSelection] = useState<{
      projectFileKey: string | null;
      project: ProjectInfo | null;
    }>({ projectFileKey: null, project: null });

    // Get the current projectFile key for invalidation
    const projectFileKey = projectFile?.file ?? null;

    // Derive the current project: controlled > user selection > first available
    const currentProject = useMemo(() => {
      // Controlled mode
      if (selectedProject) return selectedProject;

      // User selection (if still valid for current projectFile)
      if (
        userProjectSelection.projectFileKey === projectFileKey &&
        userProjectSelection.project
      ) {
        return userProjectSelection.project;
      }

      // Default to first project
      return projectFile?.projects[0] ?? null;
    }, [selectedProject, userProjectSelection, projectFileKey, projectFile]);

    // Track overridden prop values with the project key they belong to
    // This allows us to automatically discard overrides when project changes without setState
    const [propOverridesWithKey, setPropOverridesWithKey] = useState<{
      projectKey: string | null;
      overrides: Record<string, unknown>;
    }>({ projectKey: null, overrides: {} });

    // Get current project key for comparison
    const currentProjectKey = currentProject?.export_name ?? null;

    // Compute prop values: merge defaults with project args and applicable user overrides
    const propValues = useMemo(() => {
      let baseValues: Record<string, unknown> = {};

      if (projectFile && currentProject) {
        // Use project args
        const defaultArgs = projectFile.meta.default_args || {};
        const projectArgs = currentProject.args || {};
        baseValues = { ...defaultArgs, ...projectArgs };
      } else if (details?.props) {
        // Fall back to prop defaults
        for (const prop of details.props) {
          if (prop.default_value !== undefined) {
            baseValues[prop.name] = prop.default_value;
          }
        }
      }

      // Only apply overrides if they're for the current project
      const applicableOverrides =
        propOverridesWithKey.projectKey === currentProjectKey
          ? propOverridesWithKey.overrides
          : {};

      return { ...baseValues, ...applicableOverrides };
    }, [
      projectFile,
      currentProject,
      details,
      propOverridesWithKey,
      currentProjectKey,
    ]);

    // Notify parent when project changes to the default (on initial mount or projectFile change)
    const notifiedProjectRef = useRef<string | null>(null);
    useEffect(() => {
      if (
        onSelectProject &&
        currentProject &&
        currentProject.export_name !== notifiedProjectRef.current
      ) {
        notifiedProjectRef.current = currentProject.export_name;
        onSelectProject(currentProject);
      }
    }, [currentProject, onSelectProject]);

    // Handle project selection
    const handleProjectChange = useCallback(
      (event: ChangeEvent<HTMLSelectElement>) => {
        const projectName = event.target.value;
        const project = projectFile?.projects.find(
          (project) => project.export_name === projectName
        );
        if (project) {
          if (onSelectProject) {
            onSelectProject(project);
          }
          // Always update internal selection for uncontrolled mode
          setUserProjectSelection({
            projectFileKey: projectFile?.file ?? null,
            project,
          });
        }
      },
      [projectFile, onSelectProject]
    );

    // Handle prop value change
    const handlePropChange = useCallback(
      (name: string, value: unknown) => {
        setPropOverridesWithKey((prev) => ({
          projectKey: currentProjectKey,
          overrides:
            prev.projectKey === currentProjectKey
              ? { ...prev.overrides, [name]: value }
              : { [name]: value },
        }));
      },
      [currentProjectKey]
    );

    // Handle open source
    const handleOpenSource = useCallback(() => {
      onOpenSource?.(preview.filePath, preview.line);
    }, [onOpenSource, preview.filePath, preview.line]);

    // Design tokens - local (component-specific)
    const designTokens = useDesignTokens({
      filePath: preview.filePath,
      additionalPaths: projectFile ? [projectFile.file] : [],
    });

    // Global tokens CSS from scanned repo tokens
    const globalTokenCSS = useAtomValue(tokenCSSAtom);

    // Combine global and local token CSS
    // Global tokens come first, local can override
    const combinedTokenCSS = useMemo(() => {
      const local = designTokens.generateCSS();
      if (!globalTokenCSS && !local) return "";
      if (!globalTokenCSS) return local;
      if (!local) return globalTokenCSS;
      // Combine: global first, local overrides
      return `${globalTokenCSS}\n\n/* Component-specific tokens */\n${local}`;
    }, [globalTokenCSS, designTokens]);

    // Get relative path for display
    const displayPath = useMemo(() => {
      const parts = preview.filePath.split("/");
      const srcIndex = parts.findIndex(
        (pathSegment) =>
          pathSegment === "src" ||
          pathSegment === "app" ||
          pathSegment === "lib"
      );
      if (srcIndex >= 0) {
        return parts.slice(srcIndex).join("/");
      }
      return parts.slice(-3).join("/");
    }, [preview.filePath]);

    return (
      <div className="flex h-full flex-col">
        {/* File Bar - matches explorer FileHeader style */}
        <div className={HEADER_CLASSES.fileBar}>
          <Code2 size={14} className="shrink-0 text-text-3" />
          <span className="truncate text-[13px] text-text-2">
            {displayPath}
          </span>
          <span className="shrink-0 text-[11px] text-text-4">
            :{preview.line}
          </span>
          <span className="shrink-0 px-1.5 text-[11px] text-text-4">›</span>
          <span className="truncate text-[13px] font-medium text-text-1">
            {preview.name}
          </span>
          {details?.props_type_name && (
            <span className="shrink-0 text-[11px] text-text-4">
              ({details.props_type_name})
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Actions */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              className={HEADER_BUTTON.action}
              title={t("tooltips.refreshProps")}
            >
              <RefreshCw size={HEADER_ICON_SIZE.sm} />
            </button>
          )}
          <button
            onClick={handleOpenSource}
            className={HEADER_BUTTON.action}
            title={t("tooltips.openSource")}
          >
            <ExternalLink size={HEADER_ICON_SIZE.sm} />
          </button>
        </div>

        {/* Description */}
        {details?.description && (
          <div className="border-b border-border-2 bg-bg-1 px-3 py-2">
            <p className="text-xs text-text-2">{details.description}</p>
          </div>
        )}

        {/* Main content - always mounted to keep PreviewWebview stable */}
        <div className="relative flex flex-1 overflow-hidden">
          {/* Loading overlay */}
          {isLoading && (
            <Placeholder
              variant="loading"
              title={t("workstation.extractingProps")}
              className="absolute inset-0 z-10"
            />
          )}

          {/* Props panel (left) */}
          <div className="w-64 shrink-0 overflow-y-auto border-r border-border-2 bg-bg-1">
            {/* Project selector (if projectFile exists) */}
            {projectFile && projectFile.projects.length > 0 && (
              <div className="border-b border-border-2 px-3 py-2">
                <label className="mb-1 block text-xs font-medium uppercase text-text-3">
                  Project
                </label>
                <select
                  value={currentProject?.export_name ?? ""}
                  onChange={handleProjectChange}
                  className="w-full rounded border border-border-2 bg-pane-input px-2 py-1 text-sm text-text-1"
                >
                  {projectFile.projects.map((project) => (
                    <option
                      key={project.export_name}
                      value={project.export_name}
                    >
                      {project.name}
                    </option>
                  ))}
                </select>
                {currentProject?.description && (
                  <p className="mt-1 text-xs text-text-3">
                    {currentProject.description}
                  </p>
                )}
              </div>
            )}

            {/* Tokens section */}
            <TokensPanel
              tokens={designTokens.tokens}
              loading={designTokens.loading}
              onAddToken={designTokens.addToken}
              onRemoveToken={designTokens.removeToken}
              onUpdateToken={designTokens.updateToken}
              onResetToken={designTokens.resetToken}
              onRefresh={designTokens.refresh}
            />

            <div className="border-b border-border-2 px-3 py-2">
              <span className="text-xs font-medium uppercase text-text-3">
                Props ({Object.keys(propValues).length})
              </span>
            </div>
            <PropsPanel
              props={details?.props || []}
              values={propValues}
              onChange={handlePropChange}
            />
          </div>

          {/* Preview (right) - always mounted */}
          <div className="flex-1 overflow-hidden">
            <PreviewWebview
              componentName={preview.name}
              componentPath={projectFile?.file || preview.filePath}
              projectName={currentProject?.export_name || null}
              propValues={propValues}
              tokenCSS={combinedTokenCSS}
              repoPath={repoPath}
            />
          </div>
        </div>
      </div>
    );
  }
);

ComponentPreviewPanel.displayName = "ComponentPreviewPanel";

export default ComponentPreviewPanel;
