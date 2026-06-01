/**
 * Utility functions for DesignTabRepoComponents
 */
import { BookOpen, Code2, FolderCode, Play } from "lucide-react";
import { createElement } from "react";

import type { TreePanelNode } from "@src/components/TreePanelSidebar/types";
import type { CatalogEntry } from "@src/modules/WorkStation/Browser/hooks/useComponentCatalog";
import type { ProjectFileInfo } from "@src/modules/WorkStation/Browser/hooks/useOrgiiProjects";

import { STORY_ICON_SIZE, TREE_ICON_SIZE } from "../../config";

/**
 * Get the directory path from a file path
 */
export function getDirectoryPath(filePath: string): string {
  const parts = filePath.split("/");
  return parts.slice(0, -1).join("/");
}

/**
 * Convert CatalogEntry[] to TreePanelNode[] grouped by directory
 */
export function catalogToTreeNodes(
  entries: CatalogEntry[],
  repoPath: string,
  expandedDirs: Set<string>,
  expandedComponents: Set<string>,
  projectsMap: Map<string, ProjectFileInfo>,
  projectFileDirs: Set<string>
): TreePanelNode[] {
  // Group entries by directory
  const byDir: Record<string, CatalogEntry[]> = {};

  for (const entry of entries) {
    // Get relative directory path
    const relativePath = entry.location.file.startsWith(repoPath + "/")
      ? entry.location.file.slice(repoPath.length + 1)
      : entry.location.file;
    const parts = relativePath.split("/");
    const dir = parts.slice(0, -1).join("/") || ".";

    if (!byDir[dir]) {
      byDir[dir] = [];
    }
    byDir[dir].push(entry);
  }

  // Sort directories
  const sortedDirs = Object.keys(byDir).sort();

  // Convert to tree nodes
  const nodes: TreePanelNode[] = [];

  for (const dir of sortedDirs) {
    const dirEntries = byDir[dir];

    const dirNode: TreePanelNode = {
      id: `dir:${dir}`,
      name: dir === "." ? "root" : dir,
      path: `dir:${dir}`,
      type: "directory",
      expanded: expandedDirs.has(dir),
      icon: createElement(FolderCode, {
        size: TREE_ICON_SIZE,
        className: "text-text-3",
      }),
      children: dirEntries.map((entry) => {
        const componentKey = `${entry.location.file}:${entry.name}`;
        const componentDir = getDirectoryPath(entry.location.file);

        // Check if this component's directory has a project file
        const hasProjectFile = projectFileDirs.has(componentDir);

        // Get loaded project info (if already loaded)
        const projectFile = projectsMap.get(componentDir);
        const hasLoadedProjects =
          projectFile && projectFile.projects.length > 0;
        const isExpanded = expandedComponents.has(componentKey);

        // Create component node - show expand arrow if project file exists
        const componentNode: TreePanelNode = {
          id: `repo:${componentKey}`,
          name: entry.name,
          path: `repo:${componentKey}`,
          type: hasProjectFile ? "directory" : ("file" as const),
          expanded: isExpanded,
          icon: hasProjectFile
            ? createElement(BookOpen, {
                size: TREE_ICON_SIZE,
                className: "text-primary-6",
              })
            : createElement(Code2, {
                size: TREE_ICON_SIZE,
                className: "text-primary-6",
              }),
          secondaryText: hasLoadedProjects
            ? `${projectFile.projects.length} projects`
            : hasProjectFile
              ? "has projects"
              : entry.location.kind.replace("_def", ""),
        };

        // Add projects as children if component is expanded and projects are loaded
        if (hasLoadedProjects && isExpanded) {
          componentNode.children = projectFile.projects.map((project) => ({
            id: `project:${componentKey}:${project.export_name}`,
            name: project.name,
            path: `project:${componentKey}:${project.export_name}`,
            type: "file" as const,
            icon: createElement(Play, {
              size: STORY_ICON_SIZE,
              className: "text-success-6",
            }),
            secondaryText: project.description?.slice(0, 30) || undefined,
          }));
        }

        return componentNode;
      }),
    };

    nodes.push(dirNode);
  }

  return nodes;
}

/**
 * Derive repo path from component entries if not explicitly provided
 */
export function deriveRepoPath(
  repoPathProp: string | undefined,
  components: CatalogEntry[]
): string {
  if (repoPathProp) return repoPathProp;
  if (components.length === 0) return "";

  // Find common prefix
  const firstFile = components[0].location.file;
  const parts = firstFile.split("/");

  // Find src or similar directory
  const srcIndex = parts.findIndex(
    (part) => part === "src" || part === "app" || part === "lib"
  );

  if (srcIndex > 0) {
    return parts.slice(0, srcIndex).join("/");
  }

  return parts.slice(0, -2).join("/");
}

/**
 * Build set of directories that have project files
 */
export function buildProjectFileDirs(projectFiles: string[]): Set<string> {
  const dirs = new Set<string>();
  for (const projectPath of projectFiles) {
    // Project file path: /path/to/Component/Button.orgii.tsx
    // Component directory: /path/to/Component
    const dir = getDirectoryPath(projectPath);
    dirs.add(dir);
  }
  return dirs;
}

/**
 * Simplify error message for display
 */
export function simplifyErrorMessage(error: string): string {
  if (error.includes("not indexed")) {
    return "Repo not indexed";
  }
  if (error.includes("No repository")) {
    return "No repo selected";
  }
  return "Failed to load components";
}
