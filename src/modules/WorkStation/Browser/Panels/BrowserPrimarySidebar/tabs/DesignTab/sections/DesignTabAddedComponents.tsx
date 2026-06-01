/**
 * DesignTabAddedComponents - Components with storybooks section
 */
import { BookOpen } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { TreePanelNode } from "@src/components/TreePanelSidebar/types";
import { useOrgiiProjects } from "@src/modules/WorkStation/Browser/hooks/useOrgiiProjects";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

import { TREE_ICON_SIZE } from "../config";
import type { DesignTabAddedComponentsProps } from "../types";
import { DesignTreeContent } from "./DesignTreeContent";

export const DesignTabAddedComponents: React.FC<DesignTabAddedComponentsProps> =
  memo(
    ({
      repoPath: repoPathProp,
      onSelectComponent,
      selectedPath,
      showFilter = false,
      onRegisterRefresh,
    }) => {
      const { t } = useTranslation();
      const { projectFiles, loading, error, refresh, extractProjects } =
        useOrgiiProjects({ repoPath: repoPathProp });

      const [filterQuery, setFilterQuery] = useState("");

      // Register refresh with parent
      useEffect(() => {
        onRegisterRefresh?.(refresh);
      }, [onRegisterRefresh, refresh]);

      // Convert project files to flat tree nodes (no children)
      const treeData = useMemo(() => {
        const nodes: TreePanelNode[] = [];

        for (const projectPath of projectFiles) {
          // Extract component name from path
          // e.g., /path/to/Button/Button.orgii.tsx -> Button
          const parts = projectPath.split("/");
          const dirName = parts[parts.length - 2] || "Component";

          const componentNode: TreePanelNode = {
            id: projectPath,
            name: dirName,
            path: projectPath,
            type: "file" as const,
            icon: <BookOpen size={TREE_ICON_SIZE} className="text-primary-6" />,
          };

          nodes.push(componentNode);
        }

        return nodes;
      }, [projectFiles]);

      // Filter if query is set
      const filteredTreeData = useMemo(() => {
        if (!filterQuery.trim()) return treeData;
        const query = filterQuery.toLowerCase();
        return treeData.filter((node) =>
          node.name.toLowerCase().includes(query)
        );
      }, [treeData, filterQuery]);

      // Handle node selection - load projects and call callback
      const handleSelectNode = useCallback(
        async (path: string, _node: TreePanelNode) => {
          // Extract projects and call callback
          const projectFile = await extractProjects(path);
          if (projectFile) {
            onSelectComponent?.(projectFile);
          }
        },
        [extractProjects, onSelectComponent]
      );

      // No-op for directories (flat list)
      const handleToggleDirectory = useCallback(() => {}, []);

      // Loading state
      if (loading) {
        return (
          <Placeholder variant="loading" placement="sidebar" fillParentHeight />
        );
      }

      // Error state
      if (error) {
        return (
          <Placeholder
            variant="error"
            title={error}
            subtitle={t("placeholders.retryToScanAgain")}
            onRetry={refresh}
            placement="sidebar"
            fillParentHeight
          />
        );
      }

      // Empty state
      if (projectFiles.length === 0) {
        return (
          <Placeholder
            variant="empty"
            title={t("placeholders.noStorybooksFound")}
            subtitle={t("placeholders.createOrgiiFiles")}
            placement="sidebar"
            fillParentHeight
          />
        );
      }

      return (
        <DesignTreeContent
          treeData={filteredTreeData}
          selectedPath={selectedPath ?? null}
          onSelectNode={handleSelectNode}
          onToggleDirectory={handleToggleDirectory}
          filterQuery={filterQuery}
          onFilterChange={setFilterQuery}
          filterPlaceholder="Filter..."
          showFilter={showFilter}
          emptyMessage="No storybooks"
          noResultsMessage="No matching components"
        />
      );
    }
  );

DesignTabAddedComponents.displayName = "DesignTabAddedComponents";
