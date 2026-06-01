/**
 * DesignTabRepoComponents - Repository components (candidates) section
 *
 * Shows all React components scanned from the repository,
 * grouped by directory with expandable project previews.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { TreePanelNode } from "@src/components/TreePanelSidebar/types";
import { useComponentCatalog } from "@src/modules/WorkStation/Browser/hooks/useComponentCatalog";
import {
  type ProjectFileInfo,
  useOrgiiProjects,
} from "@src/modules/WorkStation/Browser/hooks/useOrgiiProjects";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

import type { DesignTabRepoComponentsProps } from "../../types";
import { DesignTreeContent } from "../DesignTreeContent";
import {
  buildProjectFileDirs,
  catalogToTreeNodes,
  deriveRepoPath,
  getDirectoryPath,
  simplifyErrorMessage,
} from "./utils";

export const DesignTabRepoComponents: React.FC<DesignTabRepoComponentsProps> =
  memo(
    ({
      repoPath: repoPathProp,
      onPreviewComponent,
      onPreviewProject,
      showFilter = false,
      onRegisterCollapseAll,
      onRegisterRefresh,
    }) => {
      const { t } = useTranslation();
      const { components, loading, error, refresh, selectComponent } =
        useComponentCatalog({ repoPath: repoPathProp });

      const { projectFiles, getComponentProjects } = useOrgiiProjects({
        repoPath: repoPathProp,
      });

      const [filterQuery, setFilterQuery] = useState("");
      const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
        () => new Set()
      );
      const [expandedComponents, setExpandedComponents] = useState<Set<string>>(
        () => new Set()
      );
      // Map: component directory path -> ProjectFileInfo
      const [projectsMap, setProjectsMap] = useState<
        Map<string, ProjectFileInfo>
      >(() => new Map());

      // Build set of directories that have project files
      const projectFileDirs = useMemo(
        () => buildProjectFileDirs(projectFiles),
        [projectFiles]
      );

      // Collapse all directories and components
      const collapseAll = useCallback(() => {
        setExpandedDirs(new Set());
        setExpandedComponents(new Set());
      }, []);

      // Register callbacks with parent
      useEffect(() => {
        onRegisterCollapseAll?.(collapseAll);
      }, [onRegisterCollapseAll, collapseAll]);

      useEffect(() => {
        onRegisterRefresh?.(refresh);
      }, [onRegisterRefresh, refresh]);

      // Use provided repoPath or derive from first entry
      const repoPath = useMemo(
        () => deriveRepoPath(repoPathProp, components),
        [repoPathProp, components]
      );

      // Load projects for components when they're expanded
      const loadProjectsForComponent = useCallback(
        async (filePath: string) => {
          const componentDir = getDirectoryPath(filePath);

          // Check if already loaded
          if (projectsMap.has(componentDir)) return;

          const projectFile = await getComponentProjects(filePath);
          if (projectFile) {
            setProjectsMap((prev) => {
              const next = new Map(prev);
              // Key by component directory, not project file path
              next.set(componentDir, projectFile);
              return next;
            });
          }
        },
        [getComponentProjects, projectsMap]
      );

      // Convert to tree nodes
      const treeData = useMemo(
        () =>
          catalogToTreeNodes(
            components,
            repoPath,
            expandedDirs,
            expandedComponents,
            projectsMap,
            projectFileDirs
          ),
        [
          components,
          repoPath,
          expandedDirs,
          expandedComponents,
          projectsMap,
          projectFileDirs,
        ]
      );

      // Filter if query is set
      const filteredTreeData = useMemo(() => {
        if (!filterQuery.trim()) return treeData;
        const query = filterQuery.toLowerCase();

        return treeData
          .map((dirNode) => ({
            ...dirNode,
            children: dirNode.children?.filter(
              (child) =>
                child.name.toLowerCase().includes(query) ||
                child.children?.some((project) =>
                  project.name.toLowerCase().includes(query)
                )
            ),
          }))
          .filter((node) => node.children && node.children.length > 0);
      }, [treeData, filterQuery]);

      // Handle node selection (preview component or project)
      const handleSelectNode = useCallback(
        async (path: string, _node: TreePanelNode) => {
          // Skip directory nodes
          if (path.startsWith("dir:")) return;

          // Handle project selection: project:filePath:componentName:projectExportName
          if (path.startsWith("project:")) {
            const rest = path.slice(6); // Remove "project:"
            const parts = rest.split(":");
            if (parts.length < 3) return;

            const projectExportName = parts.pop()!;
            const componentName = parts.pop()!;
            const filePath = parts.join(":");
            const componentDir = getDirectoryPath(filePath);

            // Find the component entry
            const entry = components.find(
              (entryItem) =>
                entryItem.location.file === filePath &&
                entryItem.name === componentName
            );

            // Find the project file (keyed by component directory)
            const projectFile = projectsMap.get(componentDir);

            if (entry && projectFile) {
              const project = projectFile.projects.find(
                (projectItem) => projectItem.export_name === projectExportName
              );
              if (project) {
                onPreviewProject?.(entry, project, projectFile);
              }
            }
            return;
          }

          // Parse component path: repo:filePath:componentName
          if (path.startsWith("repo:")) {
            const rest = path.slice(5); // Remove "repo:"
            const lastColonIndex = rest.lastIndexOf(":");
            if (lastColonIndex === -1) return;

            const filePath = rest.slice(0, lastColonIndex);
            const componentName = rest.slice(lastColonIndex + 1);

            // Find the entry
            const entry = components.find((entryItem) => {
              return (
                entryItem.location.file === filePath &&
                entryItem.name === componentName
              );
            });

            if (entry) {
              // Extract props (lazy)
              const details = await selectComponent(entry);
              if (details) {
                onPreviewComponent?.(entry);
              }
            }
          }
        },
        [
          components,
          selectComponent,
          onPreviewComponent,
          onPreviewProject,
          projectsMap,
        ]
      );

      // Toggle directory or component expansion
      const handleToggleDirectory = useCallback(
        (path: string) => {
          // Handle directory toggle
          if (path.startsWith("dir:")) {
            const dir = path.replace("dir:", "");
            setExpandedDirs((prev) => {
              const next = new Set(prev);
              if (next.has(dir)) {
                next.delete(dir);
              } else {
                next.add(dir);
              }
              return next;
            });
            return;
          }

          // Handle component toggle (for projects)
          if (path.startsWith("repo:")) {
            const rest = path.slice(5);
            const lastColonIndex = rest.lastIndexOf(":");
            if (lastColonIndex === -1) return;

            const filePath = rest.slice(0, lastColonIndex);
            const componentKey = rest;

            // Toggle expansion
            setExpandedComponents((prev) => {
              const next = new Set(prev);
              if (next.has(componentKey)) {
                next.delete(componentKey);
              } else {
                next.add(componentKey);
                // Load projects when expanding
                loadProjectsForComponent(filePath);
              }
              return next;
            });
          }
        },
        [loadProjectsForComponent]
      );

      // Loading state
      if (loading) {
        return (
          <Placeholder variant="loading" placement="sidebar" fillParentHeight />
        );
      }

      // Error state
      if (error) {
        const errorMessage = simplifyErrorMessage(error);
        return (
          <Placeholder
            variant="error"
            title={errorMessage}
            subtitle={t("placeholders.retryToScanAgain")}
            onRetry={refresh}
            placement="sidebar"
            fillParentHeight
          />
        );
      }

      // Empty state
      if (components.length === 0) {
        return (
          <Placeholder
            variant="empty"
            title={t("placeholders.noComponentsFound")}
            subtitle={t("placeholders.openRepoWithComponents")}
            placement="sidebar"
            fillParentHeight
          />
        );
      }

      return (
        <DesignTreeContent
          treeData={filteredTreeData}
          selectedPath={null}
          onSelectNode={handleSelectNode}
          onToggleDirectory={handleToggleDirectory}
          filterQuery={filterQuery}
          onFilterChange={setFilterQuery}
          filterPlaceholder="Filter..."
          showFilter={showFilter}
          emptyMessage="No components"
          noResultsMessage="No matching components"
        />
      );
    }
  );

DesignTabRepoComponents.displayName = "DesignTabRepoComponents";
