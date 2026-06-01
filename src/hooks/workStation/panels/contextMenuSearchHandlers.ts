/**
 * contextMenuSearchHandlers
 *
 * Pure async search functions for each context-menu layer type.
 * Extracted from useContextMenu to keep the hook file under 600 lines.
 */
import { projectApi } from "@src/api/http/project";
import { searchSemantic } from "@src/api/tauri/search/semantic";
import { STYLE_CONFIG } from "@src/scaffold/ContextMenu/config";
import type { SearchResultItem } from "@src/scaffold/ContextMenu/types";
import type { Session } from "@src/store/session/sessionAtom";
import { getFaviconUrl } from "@src/store/ui/globalTabsAtom";
import type { BrowserTab } from "@src/store/ui/globalTabsTypes";
import {
  isNativeSearchAvailable,
  searchFilesNative,
} from "@src/util/platform/tauri/fileSearch";
import { stripPillReferences } from "@src/util/session/stripPillReferences";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

// ── Files ─────────────────────────────────────────────────────────────────────

export async function searchFiles(
  query: string,
  repoPath: string,
  getFilteredRepos: (query: string) => Array<{ path: string; name: string }>
): Promise<SearchResultItem[]> {
  if (!repoPath || repoPath.trim() === "") return [];
  if (!isNativeSearchAvailable()) return [];

  const searchQuery = query.trim();
  const startedAt = performance.now();
  const results = await searchFilesNative({
    root_path: repoPath,
    query: searchQuery,
    max_results: STYLE_CONFIG.searchResultsMaxItems,
  });
  const elapsedMs = Math.round(performance.now() - startedAt);
  if (elapsedMs > 500) {
    console.warn("[ContextMenu] Slow file search", {
      elapsedMs,
      nativeSearchTimeMs: results.search_time_ms,
      totalIndexed: results.total_indexed,
      queryLength: searchQuery.length,
    });
  }

  const repoItems: SearchResultItem[] = getFilteredRepos(searchQuery).map(
    (repo) => ({
      type: "folder" as const,
      path: repo.path,
      name: repo.name,
      iconType: "repo" as const,
    })
  );

  return [...repoItems, ...results.folders, ...results.files];
}

// ── Terminals ────────────────────────────────────────────────────────────────

interface TerminalLike {
  id: string;
  name: string;
  isActive?: boolean;
}

export function searchTerminals(
  query: string,
  sessions: TerminalLike[]
): SearchResultItem[] {
  const filtered = query.trim()
    ? sessions.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
    : sessions;

  return filtered.map((terminal) => ({
    path: terminal.id,
    name: terminal.name || "Terminal",
    description: terminal.isActive ? "Active" : "",
    type: "file" as const,
    iconType: "terminal" as const,
  }));
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export function searchSessions(
  query: string,
  allSessions: Session[]
): SearchResultItem[] {
  const filtered = query.trim()
    ? allSessions.filter(
        (session) =>
          session.user_input?.toLowerCase().includes(query.toLowerCase()) ||
          session.name?.toLowerCase().includes(query.toLowerCase())
      )
    : allSessions;

  const sorted = [...filtered].sort((left, right) => {
    const leftTime = new Date(left.updated_at || left.created_at).getTime();
    const rightTime = new Date(right.updated_at || right.created_at).getTime();
    return rightTime - leftTime;
  });

  return sorted.slice(0, 20).map((session) => {
    const timeAgo = formatRelativeTime(
      session.updated_at || session.created_at
    );
    const goal = stripPillReferences(
      session.name || session.user_input || "Session"
    );
    const truncatedGoal =
      goal.length > 50 ? goal.substring(0, 47) + "..." : goal;
    return {
      path: session.session_id,
      name: truncatedGoal,
      description: timeAgo,
      type: "file" as const,
      iconType: "session" as const,
    };
  });
}

// ── Browser tabs ─────────────────────────────────────────────────────────────

export function searchBrowserTabs(
  query: string,
  browserTabs: BrowserTab[]
): SearchResultItem[] {
  const filtered = query.trim()
    ? browserTabs.filter(
        (tab) =>
          tab.title.toLowerCase().includes(query.toLowerCase()) ||
          tab.url?.toLowerCase().includes(query.toLowerCase())
      )
    : browserTabs;

  const sorted = [...filtered].sort(
    (left, right) => (right.timestamp || 0) - (left.timestamp || 0)
  );

  return sorted.map((tab) => ({
    path: tab.id,
    name: tab.title || tab.url || "New Tab",
    description: formatRelativeTime(tab.timestamp),
    type: "file" as const,
    iconType: "browser" as const,
    favicon: tab.favicon || getFaviconUrl(tab.url),
  }));
}

// ── Codebase semantic search ─────────────────────────────────────────────────

export interface CodebaseSearchItem extends SearchResultItem {
  startLine: number;
  endLine: number;
  snippet: string;
}

export async function searchCodebase(
  query: string,
  repoPath: string
): Promise<CodebaseSearchItem[]> {
  if (!query.trim()) return [];
  const hits = await searchSemantic(query, repoPath || undefined, 10);
  return hits.map((hit) => {
    const fileName = hit.relative_path.split("/").pop() ?? hit.relative_path;
    const lineRange = `${hit.relative_path}:${hit.start_line}-${hit.end_line}`;
    const snippetPreview = hit.content
      .split("\n")
      .slice(0, 2)
      .join(" ")
      .trim()
      .slice(0, 60);
    return {
      type: "file" as const,
      path: `${hit.repo_path}/${hit.relative_path}`,
      name: `${fileName} :${hit.start_line}-${hit.end_line}`,
      description: snippetPreview || lineRange,
      startLine: hit.start_line,
      endLine: hit.end_line,
      snippet: hit.content,
    };
  });
}

// ── Projects (with drill-down support) ───────────────────────────────────────

export interface DrilledProject {
  slug: string;
  name: string;
}

export async function searchProjects(
  query: string,
  _effectiveRepoPath: string,
  drilledProject: DrilledProject | null
): Promise<SearchResultItem[]> {
  const lowerQuery = query.trim().toLowerCase();

  if (drilledProject) {
    const allItems: SearchResultItem[] = [];
    const projectDisplayName = drilledProject.name.replace(/^🧑 /, "");
    const matchesProjectSelf =
      !lowerQuery || projectDisplayName.toLowerCase().includes(lowerQuery);

    if (matchesProjectSelf) {
      allItems.push({
        type: "folder" as const,
        path: drilledProject.slug,
        name: drilledProject.name,
        description: "Select project",
        iconType: "project" as const,
      });
    }

    try {
      const workItems = await projectApi.readWorkItems(drilledProject.slug);
      for (const item of workItems) {
        const itemLabel = `${item.frontmatter.short_id}: ${item.frontmatter.title}`;
        const matchesItem =
          !lowerQuery ||
          itemLabel.toLowerCase().includes(lowerQuery) ||
          item.frontmatter.status.toLowerCase().includes(lowerQuery);
        if (matchesItem) {
          allItems.push({
            type: "file" as const,
            path: `${drilledProject.slug}/${item.frontmatter.short_id}`,
            name: itemLabel,
            description: item.frontmatter.status,
            iconType: "workitem" as const,
          });
        }
      }
    } catch (_err) {
      // Work items may not exist for this project
    }

    return allItems;
  }

  // Not drilled — show project list
  const allItems: SearchResultItem[] = [];
  const personalSlugs = new Set<string>();

  try {
    const personalPath = await projectApi.personalWorkspace();
    const personalProjects = await projectApi.readProjects();
    for (const project of personalProjects) {
      if (project.meta.linked_repos.includes(personalPath)) {
        personalSlugs.add(project.slug);
      }
    }
  } catch (_err) {
    // Personal workspace may not exist
  }

  let projects: Awaited<ReturnType<typeof projectApi.readProjects>> = [];
  try {
    projects = await projectApi.readProjects();
  } catch (_err) {
    // Repo may have no projects
  }

  for (const project of projects) {
    const projectName = project.meta.name || project.slug;
    const isPersonal = personalSlugs.has(project.slug);
    const displayName = isPersonal ? `🧑 ${projectName}` : projectName;
    const matchesProject =
      !lowerQuery || projectName.toLowerCase().includes(lowerQuery);
    if (matchesProject) {
      allItems.push({
        type: "folder" as const,
        path: project.slug,
        name: displayName,
        description: project.meta.status || "",
        iconType: "project" as const,
      });
    }
  }

  return allItems;
}
