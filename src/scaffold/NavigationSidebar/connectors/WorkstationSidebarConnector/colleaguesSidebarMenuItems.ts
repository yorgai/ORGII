import { Users } from "lucide-react";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type {
  CollabOrgRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";

export const COLLAB_ORG_SECTION_PREFIX = "colleagues-org-section:";
export const COLLAB_TEAMMATE_SESSION_PREFIX = "colleagues-teammate-session:";

function normalizeSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function matchesSearchQuery(
  query: string,
  ...values: Array<string | undefined>
): boolean {
  if (!query) return true;
  return values.some((value) =>
    value ? normalizeSearchValue(value).includes(query) : false
  );
}

export function getCollabTeammateSessionMenuItemId(sessionId: string): string {
  return `${COLLAB_TEAMMATE_SESSION_PREFIX}${sessionId}`;
}

export function buildColleaguesSidebarMenuItems({
  orgs,
  remoteSessions,
  searchQuery,
  unknownOrgLabel,
}: {
  orgs: readonly CollabOrgRecord[];
  remoteSessions: readonly RemoteTeammateSessionMetadata[];
  searchQuery: string;
  unknownOrgLabel: string;
}): NavigationMenuItem[] {
  const normalizedQuery = normalizeSearchValue(searchQuery);
  const orgsById = new Map(orgs.map((org) => [org.id, org]));
  const sessionsByOrgId = new Map<string, RemoteTeammateSessionMetadata[]>();

  for (const session of remoteSessions) {
    const orgSessions = sessionsByOrgId.get(session.orgId) ?? [];
    orgSessions.push(session);
    sessionsByOrgId.set(session.orgId, orgSessions);
  }

  const menuItems: NavigationMenuItem[] = [];

  for (const org of orgs) {
    const orgSessions = sessionsByOrgId.get(org.id) ?? [];
    const filteredSessions = orgSessions.filter((session) =>
      matchesSearchQuery(
        normalizedQuery,
        org.name,
        session.title,
        session.ownerDisplayName,
        session.repoPath,
        session.branch,
        session.status
      )
    );

    if (
      normalizedQuery &&
      filteredSessions.length === 0 &&
      !matchesSearchQuery(normalizedQuery, org.name)
    ) {
      continue;
    }

    menuItems.push({
      id: `${COLLAB_ORG_SECTION_PREFIX}${org.id}`,
      key: `${COLLAB_ORG_SECTION_PREFIX}${org.id}`,
      label: org.name,
    });

    for (const session of filteredSessions) {
      menuItems.push({
        id: getCollabTeammateSessionMenuItemId(session.id),
        key: getCollabTeammateSessionMenuItemId(session.id),
        label: session.title,
        searchText: [
          org.name,
          session.ownerDisplayName,
          session.repoPath,
          session.branch,
        ]
          .filter(Boolean)
          .join(" "),
        icon: Users,
        iconName: "users",
        shortcut: session.status,
      });
    }
  }

  if (menuItems.length > 0) {
    return menuItems;
  }

  const orphanSessions = remoteSessions.filter((session) => {
    if (orgsById.has(session.orgId)) return false;
    return matchesSearchQuery(
      normalizedQuery,
      session.title,
      session.ownerDisplayName,
      session.repoPath,
      session.branch,
      session.status
    );
  });

  if (orphanSessions.length === 0) {
    return menuItems;
  }

  menuItems.push({
    id: `${COLLAB_ORG_SECTION_PREFIX}unknown`,
    key: `${COLLAB_ORG_SECTION_PREFIX}unknown`,
    label: unknownOrgLabel,
  });

  for (const session of orphanSessions) {
    menuItems.push({
      id: getCollabTeammateSessionMenuItemId(session.id),
      key: getCollabTeammateSessionMenuItemId(session.id),
      label: session.title,
      searchText: [session.ownerDisplayName, session.repoPath, session.branch]
        .filter(Boolean)
        .join(" "),
      icon: Users,
      iconName: "users",
      shortcut: session.status,
    });
  }

  return menuItems;
}
