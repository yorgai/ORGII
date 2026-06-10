import { describe, expect, it } from "vitest";

import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelSelectedWorkspace,
} from "@src/store/ui/chatPanelAtom";

import {
  FOLDERS_DASHBOARD_ITEM_ID,
  FOLDERS_EXPLORE_ITEM_ID,
} from "./foldersSidebarMenuItems";
import { resolveSelectedMenuItemIds } from "./menuSelection";

function resolveFoldersSelection(overrides: {
  chatPanelExploreOpen?: boolean;
  chatPanelWorkspaceDashboardOpen?: boolean;
  chatPanelSelectedWorkspace?: ChatPanelSelectedWorkspace | null;
}): string {
  return resolveSelectedMenuItemIds({
    activeSessionCreatorDraftId: null,
    activeSessionId: "session-1",
    activeSidebarKey: "folders",
    chatPanelContentMode: CHAT_PANEL_CONTENT_MODE.NON_SESSION,
    chatPanelCreateTarget: CHAT_PANEL_CREATE_TARGET.AGENT_SESSION,
    chatPanelSelectedProject: null,
    chatPanelSelectedWorkItem: null,
    chatPanelSelectedWorkspace: overrides.chatPanelSelectedWorkspace ?? null,
    chatPanelWorkspaceDashboardOpen:
      overrides.chatPanelWorkspaceDashboardOpen ?? false,
    chatPanelExploreOpen: overrides.chatPanelExploreOpen ?? false,
    opsControlRoutePath: "/ops-control",
    pathname: "/workstation/code",
    projectsSelectedMenuItemId: "",
    sessionCreatorDrafts: [],
  }).selectedMenuItemId;
}

describe("resolveSelectedMenuItemIds", () => {
  it("selects Explore from the active ChatPanel surface state", () => {
    expect(resolveFoldersSelection({ chatPanelExploreOpen: true })).toBe(
      FOLDERS_EXPLORE_ITEM_ID
    );
  });

  it("selects Dashboard from the active ChatPanel surface state", () => {
    expect(
      resolveFoldersSelection({ chatPanelWorkspaceDashboardOpen: true })
    ).toBe(FOLDERS_DASHBOARD_ITEM_ID);
  });

  it("prefers workspace selection over stale Explore or Dashboard flags", () => {
    const workspace = {
      kind: "repo",
      id: "repo-1",
      name: "Repo",
    } satisfies ChatPanelSelectedWorkspace;

    expect(
      resolveFoldersSelection({
        chatPanelExploreOpen: true,
        chatPanelWorkspaceDashboardOpen: true,
        chatPanelSelectedWorkspace: workspace,
      })
    ).toBe("folders-repo:repo-1");
  });
});
