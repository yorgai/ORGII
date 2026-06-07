/**
 * ProjectManager Component
 *
 * Main entry point for Project Manager (appMode === "project" inside Workstation).
 * Wraps ProjectManagerLayout with ActionSystemProvider.
 *
 * Architecture:
 * - Rendered as a keep-alive app inside WorkStation AppShell
 * - ProjectManagerLayout handles all panel orchestration
 * - Sidebar: Projects list with create/delete
 * - Main: Work items for selected project (List, Kanban, Gantt, Calendar, Overview)
 */
import React, { memo } from "react";

import { ActionSystemProvider } from "@src/ActionSystem";

import { ProjectManagerLayout } from "./ProjectManagerLayout";

// ============================================
// Types
// ============================================

export interface ProjectManagerProps {
  /** Repository path used for project filtering and workspace actions */
  repoPath: string;
  /** Repository name for display */
  repoName: string;
}

// ============================================
// Component
// ============================================

export const ProjectManager: React.FC<ProjectManagerProps> = memo(
  ({ repoPath, repoName }) => {
    return (
      <ActionSystemProvider repoPath={repoPath} repoId={repoPath}>
        <ProjectManagerLayout repoPath={repoPath} repoName={repoName} />
      </ActionSystemProvider>
    );
  }
);

ProjectManager.displayName = "ProjectManager";

export default ProjectManager;
