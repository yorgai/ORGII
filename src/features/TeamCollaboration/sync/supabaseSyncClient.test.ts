import { afterEach, describe, expect, it, vi } from "vitest";

import { COLLAB_IDENTITY_KIND } from "@src/store/collaboration/types";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";

import { ORGII_SUPABASE_SETUP_SQL } from "./supabaseSetupSql";
import { supabaseSyncClient } from "./supabaseSyncClient";

const SUPABASE_URL = "https://team.supabase.co";
const ANON_KEY = "anon-key";

const MEMBER_PROFILE = {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  memberId: "member-1",
  memberToken: "member-token-1",
};

const ROOT_PROFILE = {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  orgSecret: "secret-1",
};

const FULL_PROFILE = { ...ROOT_PROFILE, ...MEMBER_PROFILE };

const REMOTE_SESSION: RemoteTeammateSessionMetadata = {
  id: "org-1:member-1:session-1",
  orgId: "org-1",
  ownerMemberId: "member-1",
  ownerUserId: "member-1",
  ownerDisplayName: "Ada",
  ownerIdentityKind: COLLAB_IDENTITY_KIND.HUMAN,
  sourceSessionId: "session-1",
  title: "Session",
  eventsBlobPath: undefined,
  eventsContentHash: undefined,
  eventsUpdatedAt: undefined,
};

const SERVER_MEMBER = {
  id: "member-1",
  orgId: "org-1",
  displayName: "Ada",
  avatar: { initials: "A", variant: "v" },
  role: "admin",
  identityKind: "human",
  joinedAt: "2026-06-16T00:00:00.000Z",
};

function mockJsonResponse(payload: unknown, ok = true): Response {
  return new Response(JSON.stringify(payload), {
    status: ok ? 200 : 400,
    headers: { "content-type": "application/json" },
  });
}

interface FetchMockLike {
  mock: { calls: Array<[unknown, RequestInit?]> };
}

function getRpcBody(
  fetchMock: FetchMockLike,
  rpcName: string
): Record<string, unknown> {
  const rpcCall = fetchMock.mock.calls.find(
    ([url]) => typeof url === "string" && url.includes(`/rpc/${rpcName}`)
  );
  expect(rpcCall).toBeDefined();
  return JSON.parse(String((rpcCall?.[1] as RequestInit).body)) as Record<
    string,
    unknown
  >;
}

describe("Supabase sync setup SQL", () => {
  it("declares required RPC functions and snapshot bucket", () => {
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_sync_version");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_create_org");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_upsert_project");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_upsert_work_item");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_upsert_session_metadata");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii-session-snapshots");
  });

  it("declares session events and repo scope RPCs and tables", () => {
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_upsert_session_events");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_get_session_events");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_update_org_repo_scopes");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_request_repo_join");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_review_repo_join");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_repo_join_requests");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("events_blob_path");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("events_content_hash");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("repoJoinRequests");
  });

  it("declares the v2 credential model RPCs", () => {
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_authenticate");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("credential_hash");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_revoke_invite");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_update_member_role");
  });

  it("applies since_timestamp filtering in list_org_state", () => {
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("v_since");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(">= v_since");
  });
});

describe("supabaseSyncClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies setup through the version RPC", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse(2));

    await expect(
      supabaseSyncClient.verifySetup({
        supabaseUrl: SUPABASE_URL,
        anonKey: ANON_KEY,
      })
    ).resolves.toEqual({ ok: true, schemaVersion: 2, missing: [] });

    expect(fetchMock).toHaveBeenCalledWith(
      `${SUPABASE_URL}/rest/v1/rpc/orgii_sync_version`,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("verifySetup accepts a server schema newer than the client", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockJsonResponse(3));

    await expect(
      supabaseSyncClient.verifySetup({
        supabaseUrl: SUPABASE_URL,
        anonKey: ANON_KEY,
      })
    ).resolves.toEqual({ ok: true, schemaVersion: 3, missing: [] });
  });

  it("verifySetup rejects a server schema older than the client", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockJsonResponse(1));

    await expect(
      supabaseSyncClient.verifySetup({
        supabaseUrl: SUPABASE_URL,
        anonKey: ANON_KEY,
      })
    ).resolves.toEqual({
      ok: false,
      schemaVersion: 1,
      missing: ["orgii_sync_version"],
    });
  });

  it("createOrg hashes credentials and never sends secrets in the payload", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        org: {
          id: "org-1",
          name: "Team Alpha",
          syncBackend: "supabase",
          supabaseUrl: SUPABASE_URL,
          createdAt: "2026-06-16T00:00:00.000Z",
        },
        member: SERVER_MEMBER,
      })
    );

    const result = await supabaseSyncClient.createOrg({
      supabaseUrl: `${SUPABASE_URL}/`,
      anonKey: ANON_KEY,
      orgSecret: "secret-1",
      name: "Team Alpha",
      displayName: "Ada",
      identityKind: COLLAB_IDENTITY_KIND.HUMAN,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${SUPABASE_URL}/rest/v1/rpc/orgii_create_org`
    );
    const body = getRpcBody(fetchMock, "orgii_create_org");
    expect(body.org_name).toBe("Team Alpha");
    expect(String(body.org_secret_hash)).toMatch(/^[a-f0-9]{64}$/);
    expect(String(body.member_credential_hash)).toMatch(/^[a-f0-9]{64}$/);
    const payload = body.payload as Record<string, unknown>;
    expect(payload.supabaseUrl).toBe(SUPABASE_URL);
    expect(payload).not.toHaveProperty("orgSecret");
    expect(payload).not.toHaveProperty("supabaseAnonKey");
    expect(payload).not.toHaveProperty("memberToken");

    // Local record keeps the full credential set.
    expect(result.org.orgSecret).toBe("secret-1");
    expect(result.org.memberToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.org.supabaseAnonKey).toBe(ANON_KEY);
    expect(result.org.localMemberId).toBe("member-1");
  });

  it("acceptInvite returns an org with a member token and no org secret", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        org: {
          id: "org-1",
          name: "Team Alpha",
          createdAt: "2026-06-16T00:00:00.000Z",
        },
        member: { ...SERVER_MEMBER, id: "member-2", role: "member" },
      })
    );

    const result = await supabaseSyncClient.acceptInvite({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      inviteCode: "invite-code-1",
      displayName: "Ada",
      identityKind: COLLAB_IDENTITY_KIND.HUMAN,
    });

    const body = getRpcBody(fetchMock, "orgii_accept_invite");
    expect(body.invite_code).toBe("invite-code-1");
    expect(String(body.member_credential_hash)).toMatch(/^[a-f0-9]{64}$/);
    expect(body).not.toHaveProperty("p_org_secret");

    expect(result.org.memberToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.org.orgSecret).toBeUndefined();
    expect(result.org.localMemberId).toBe("member-2");
  });

  it("createInvite keeps the plaintext code off the wire but on the local record", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse({}));

    const invite = await supabaseSyncClient.createInvite({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      usageLimit: 5,
    });

    const body = getRpcBody(fetchMock, "orgii_create_invite");
    expect(body.p_org_id).toBe("org-1");
    expect(body.p_member_id).toBe("member-1");
    expect(body.p_member_token).toBe("member-token-1");
    expect(String(body.invite_code_hash)).toMatch(/^[a-f0-9]{64}$/);
    expect(body.usage_limit).toBe(5);
    expect(body.invite_role).toBe("member");
    const payload = body.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("inviteCode");
    expect(payload).not.toHaveProperty("inviteLink");
    expect(String(payload.codeSuffix)).toHaveLength(4);

    expect(invite.inviteCode).toMatch(/^[a-f0-9]{64}$/);
    expect(invite.inviteLink).toContain("orgii://collaboration/join?");
    expect(invite.codeSuffix).toBe(invite.inviteCode?.slice(-4));
    expect(invite.role).toBe("member");
  });

  it("revokeInvite and updateMemberRole call the v2 admin RPCs", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => mockJsonResponse(null));

    await supabaseSyncClient.revokeInvite({
      ...ROOT_PROFILE,
      orgId: "org-1",
      inviteId: "invite-1",
    });
    await supabaseSyncClient.updateMemberRole({
      ...ROOT_PROFILE,
      orgId: "org-1",
      targetMemberId: "member-2",
      role: "admin",
    });

    const revokeBody = getRpcBody(fetchMock, "orgii_revoke_invite");
    expect(revokeBody.p_org_id).toBe("org-1");
    expect(revokeBody.p_org_secret).toBe("secret-1");
    expect(revokeBody.invite_id).toBe("invite-1");

    const roleBody = getRpcBody(fetchMock, "orgii_update_member_role");
    expect(roleBody.p_org_id).toBe("org-1");
    expect(roleBody.target_member_id).toBe("member-2");
    expect(roleBody.new_role).toBe("admin");
  });

  it("flexAuthParams prefers member credentials when both are present", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse(null));

    await supabaseSyncClient.updateOrgRepoScopes({
      ...FULL_PROFILE,
      orgId: "org-1",
      repoScopes: ["/repos/foo"],
    });

    const body = getRpcBody(fetchMock, "orgii_update_org_repo_scopes");
    expect(body.p_member_id).toBe("member-1");
    expect(body.p_member_token).toBe("member-token-1");
    expect(body).not.toHaveProperty("p_org_secret");
  });

  it("upsertSessionMetadata rejects when the profile has no member credential", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse(null));

    await expect(
      supabaseSyncClient.upsertSessionMetadata({
        ...ROOT_PROFILE,
        session: REMOTE_SESSION,
      })
    ).rejects.toThrow("ORGII member credential required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upsertSessionEvents uploads blob and calls the member-only RPC", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => mockJsonResponse(null));

    const events = [
      { id: "evt-1", sessionId: "session-1", chunk_id: null },
    ] as unknown as import("@src/engines/SessionCore/core/types").SessionEvent[];

    await supabaseSyncClient.upsertSessionEvents({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      sourceSessionId: "session-1",
      events,
    });

    const storageCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === "string" && url.includes("/storage/v1/object/")
    );
    expect(storageCall).toBeDefined();
    const storageUrl = String(storageCall?.[0]);
    expect(storageUrl).toContain(
      `${SUPABASE_URL}/storage/v1/object/orgii-session-snapshots/orgs/org-1/sessions/session-1/latest-`
    );
    expect(storageUrl).toMatch(/latest-[a-f0-9]{64}\.json$/);

    const rpcBody = getRpcBody(fetchMock, "orgii_upsert_session_events");
    expect(rpcBody.p_org_id).toBe("org-1");
    expect(rpcBody.p_member_id).toBe("member-1");
    expect(rpcBody.p_member_token).toBe("member-token-1");
    expect(rpcBody).not.toHaveProperty("p_org_secret");
    expect(rpcBody.source_session_id).toBe("session-1");
    expect(typeof rpcBody.blob_path).toBe("string");
    expect(typeof rpcBody.content_hash).toBe("string");
  });

  it("getSessionEvents returns ref when RPC reports blob path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        blobPath: "orgs/org-1/sessions/session-1/latest-abc.json",
        contentHash: "abc",
        updatedAt: "2026-07-01T00:00:00.000Z",
      })
    );

    await expect(
      supabaseSyncClient.getSessionEvents({
        ...ROOT_PROFILE,
        orgId: "org-1",
        sourceSessionId: "session-1",
      })
    ).resolves.toEqual({
      blobPath: "orgs/org-1/sessions/session-1/latest-abc.json",
      contentHash: "abc",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });

    const body = getRpcBody(fetchMock, "orgii_get_session_events");
    expect(body.p_org_id).toBe("org-1");
    expect(body.p_org_secret).toBe("secret-1");
    expect(body.source_session_id).toBe("session-1");
  });

  it("getSessionEvents returns null when RPC reports null blob", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockJsonResponse(null));

    await expect(
      supabaseSyncClient.getSessionEvents({
        ...MEMBER_PROFILE,
        orgId: "org-1",
        sourceSessionId: "session-1",
      })
    ).resolves.toBeNull();
  });

  it("downloadSessionEventsBlob fetches events from storage", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({ events: [{ id: "evt-1", sessionId: "session-1" }] })
    );

    const result = await supabaseSyncClient.downloadSessionEventsBlob({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      blobPath: "orgs/org-1/sessions/session-1/latest-abc.json",
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "evt-1", sessionId: "session-1" });
  });

  it("updateOrgRepoScopes falls back to the org secret credential", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse(null));

    await supabaseSyncClient.updateOrgRepoScopes({
      ...ROOT_PROFILE,
      orgId: "org-1",
      repoScopes: ["/repos/foo", "/repos/bar"],
    });

    const body = getRpcBody(fetchMock, "orgii_update_org_repo_scopes");
    expect(body.p_org_secret).toBe("secret-1");
    expect(body.p_org_id).toBe("org-1");
    expect(body).not.toHaveProperty("p_member_id");
    expect(body.repo_scopes).toEqual(["/repos/foo", "/repos/bar"]);
  });

  it("requestRepoJoin authenticates as a member and keeps requester in payload", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse(null));

    await supabaseSyncClient.requestRepoJoin({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      repoPath: "/repos/foo",
      requesterMemberId: "member-1",
    });

    const body = getRpcBody(fetchMock, "orgii_request_repo_join");
    expect(body.p_org_id).toBe("org-1");
    expect(body.p_member_id).toBe("member-1");
    expect(body.p_member_token).toBe("member-token-1");
    expect(body.repo_path).toBe("/repos/foo");
    expect(body).not.toHaveProperty("requester_member_id");
    expect(body.payload).toMatchObject({
      status: "pending",
      requesterMemberId: "member-1",
    });
  });

  it("reviewRepoJoin sends org id and approve flag without a reviewer id", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse(null));

    await supabaseSyncClient.reviewRepoJoin({
      ...ROOT_PROFILE,
      orgId: "org-1",
      requestId: "req-1",
      approve: true,
      reviewNote: "looks good",
    });

    const body = getRpcBody(fetchMock, "orgii_review_repo_join");
    expect(body.p_org_id).toBe("org-1");
    expect(body.p_org_secret).toBe("secret-1");
    expect(body.request_id).toBe("req-1");
    expect(body.approve).toBe(true);
    expect(body.review_note).toBe("looks good");
    expect(body).not.toHaveProperty("reviewer_member_id");
  });

  it("listOrgState passes since_timestamp and surfaces serverTime and tombstones", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        serverTime: "2026-07-01T12:00:00.000Z",
        orgs: [],
        members: [],
        invites: [],
        projects: [],
        workItems: [],
        sessions: [
          {
            id: "org-1:member-1:session-1",
            orgId: "org-1",
            ownerMemberId: "member-1",
            sourceSessionId: "session-1",
            eventsBlobPath: null,
            eventsContentHash: null,
            eventsUpdatedAt: null,
            deletedAt: "2026-07-01T11:00:00.000Z",
          },
        ],
        chatMessages: [],
        repoJoinRequests: [
          {
            requestId: "req-1",
            orgId: "org-1",
            requesterMemberId: "member-2",
            repoPath: "/repos/foo",
            status: "pending",
            reviewerMemberId: null,
            reviewNote: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            reviewedAt: null,
          },
        ],
        snapshotRequests: [],
      })
    );

    const result = await supabaseSyncClient.listOrgState({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      sinceTimestamp: "2026-06-01T00:00:00.000Z",
    });

    const body = getRpcBody(fetchMock, "orgii_list_org_state");
    expect(body.p_org_id).toBe("org-1");
    expect(body.since_timestamp).toBe("2026-06-01T00:00:00.000Z");

    expect(result.serverTime).toBe("2026-07-01T12:00:00.000Z");
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.deletedAt).toBe("2026-07-01T11:00:00.000Z");
    expect(result.repoJoinRequests).toHaveLength(1);
    expect(result.repoJoinRequests[0]?.repoPath).toBe("/repos/foo");
  });
});
