import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { projectApi } from "@src/api/http/project";
import {
  collabMembersAtom,
  collabOrgsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import {
  COLLAB_IDENTITY_KIND,
  COLLAB_ROLE,
  COLLAB_SYNC_BACKEND,
} from "@src/store/collaboration/types";
import type {
  CollabMemberRecord,
  CollabOrgRecord,
} from "@src/store/collaboration/types";
import {
  createInstrumentedStore,
  getInstrumentedStore,
  isStoreInitialized,
} from "@src/util/core/state/instrumentedStore";

import {
  allocateCollabAwareWorkItemId,
  canDeleteProjectUnderOrg,
} from "./collabShortId";
import { supabaseSyncClient } from "./sync/supabaseSyncClient";

vi.mock("@src/api/http/project", () => ({
  projectApi: {
    readProject: vi.fn(),
    allocateWorkItemId: vi.fn(),
  },
}));

vi.mock("./sync/supabaseSyncClient", () => ({
  supabaseSyncClient: {
    allocateWorkItemShortId: vi.fn(),
  },
}));

const projectApiMock = vi.mocked(projectApi);
const syncClientMock = vi.mocked(supabaseSyncClient);

const PROJECT_ORG_ID = "porg-1";

// Collab org whose aliased project org matches PROJECT_ORG_ID and that
// carries a full member credential (getSyncProfile returns non-null).
const COLLAB_ORG: CollabOrgRecord = {
  id: "org-1",
  name: "Team Alpha",
  projectOrgId: PROJECT_ORG_ID,
  syncBackend: COLLAB_SYNC_BACKEND.SUPABASE,
  supabaseUrl: "https://demo.supabase.co",
  supabaseAnonKey: "anon-key",
  memberToken: "member-token",
  localMemberId: "member-1",
  createdAt: "2026-07-01T00:00:00.000Z",
};

function createMember(
  overrides: Partial<CollabMemberRecord>
): CollabMemberRecord {
  return {
    id: "member-1",
    orgId: COLLAB_ORG.id,
    displayName: "Ada",
    avatar: { initials: "AD", variant: "beam" },
    role: COLLAB_ROLE.MEMBER,
    identityKind: COLLAB_IDENTITY_KIND.HUMAN,
    joinedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockProjectRead(orgId: string) {
  projectApiMock.readProject.mockResolvedValue({
    meta: { id: "project-1", org_id: orgId },
  } as Awaited<ReturnType<typeof projectApi.readProject>>);
}

beforeEach(() => {
  if (!isStoreInitialized()) createInstrumentedStore();
  const store = getInstrumentedStore();
  store.set(collabOrgsAtom, []);
  store.set(collabMembersAtom, []);
  projectApiMock.allocateWorkItemId.mockResolvedValue("LOCAL-1");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("allocateCollabAwareWorkItemId", () => {
  it("allocates on the server for a collab-synced org", async () => {
    getInstrumentedStore().set(collabOrgsAtom, [COLLAB_ORG]);
    mockProjectRead(PROJECT_ORG_ID);
    syncClientMock.allocateWorkItemShortId.mockResolvedValue({
      shortId: "SRV-7",
      n: 7,
    });

    await expect(allocateCollabAwareWorkItemId("proj")).resolves.toBe("SRV-7");
    expect(syncClientMock.allocateWorkItemShortId).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: COLLAB_ORG.id,
        projectId: "project-1",
        memberId: "member-1",
        memberToken: "member-token",
      })
    );
    // The local counter must NOT run: a local id can collide with a
    // teammate's and merge two distinct work items on push.
    expect(projectApiMock.allocateWorkItemId).not.toHaveBeenCalled();
  });

  it("uses the local counter when the org is not collab-synced", async () => {
    getInstrumentedStore().set(collabOrgsAtom, [COLLAB_ORG]);
    mockProjectRead("some-local-org");

    await expect(allocateCollabAwareWorkItemId("proj")).resolves.toBe(
      "LOCAL-1"
    );
    expect(syncClientMock.allocateWorkItemShortId).not.toHaveBeenCalled();
    expect(projectApiMock.allocateWorkItemId).toHaveBeenCalledWith("proj");
  });

  it("falls back to the local counter when the server is unreachable (documented residual)", async () => {
    getInstrumentedStore().set(collabOrgsAtom, [COLLAB_ORG]);
    mockProjectRead(PROJECT_ORG_ID);
    syncClientMock.allocateWorkItemShortId.mockRejectedValue(
      new Error("offline")
    );

    await expect(allocateCollabAwareWorkItemId("proj")).resolves.toBe(
      "LOCAL-1"
    );
  });

  it("falls back to the local counter when the member credential is missing", async () => {
    getInstrumentedStore().set(collabOrgsAtom, [
      { ...COLLAB_ORG, memberToken: undefined, orgSecret: undefined },
    ]);
    mockProjectRead(PROJECT_ORG_ID);

    await expect(allocateCollabAwareWorkItemId("proj")).resolves.toBe(
      "LOCAL-1"
    );
    expect(syncClientMock.allocateWorkItemShortId).not.toHaveBeenCalled();
  });

  it("falls back to the local counter when the project cannot be read", async () => {
    getInstrumentedStore().set(collabOrgsAtom, [COLLAB_ORG]);
    projectApiMock.readProject.mockRejectedValue(new Error("read failed"));

    await expect(allocateCollabAwareWorkItemId("proj")).resolves.toBe(
      "LOCAL-1"
    );
    expect(syncClientMock.allocateWorkItemShortId).not.toHaveBeenCalled();
  });
});

describe("canDeleteProjectUnderOrg", () => {
  it("allows deletion under a purely local org", () => {
    expect(canDeleteProjectUnderOrg("some-local-org")).toBe(true);
    expect(canDeleteProjectUnderOrg(null)).toBe(true);
    expect(canDeleteProjectUnderOrg(undefined)).toBe(true);
  });

  it("allows deletion for the collab org admin", () => {
    const store = getInstrumentedStore();
    store.set(collabOrgsAtom, [COLLAB_ORG]);
    store.set(collabMembersAtom, [createMember({ role: COLLAB_ROLE.ADMIN })]);
    expect(canDeleteProjectUnderOrg(PROJECT_ORG_ID)).toBe(true);
  });

  it("blocks deletion for a non-admin collab member (server would revert it)", () => {
    const store = getInstrumentedStore();
    store.set(collabOrgsAtom, [COLLAB_ORG]);
    store.set(collabMembersAtom, [createMember({ role: COLLAB_ROLE.MEMBER })]);
    expect(canDeleteProjectUnderOrg(PROJECT_ORG_ID)).toBe(false);
  });

  it("blocks deletion when the local membership is unknown", () => {
    const store = getInstrumentedStore();
    store.set(collabOrgsAtom, [COLLAB_ORG]);
    store.set(collabMembersAtom, []);
    expect(canDeleteProjectUnderOrg(PROJECT_ORG_ID)).toBe(false);
  });
});
