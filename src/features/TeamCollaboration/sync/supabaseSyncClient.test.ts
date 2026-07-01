import { afterEach, describe, expect, it, vi } from "vitest";

import { COLLAB_IDENTITY_KIND } from "@src/store/collaboration/types";

import { ORGII_SUPABASE_SETUP_SQL } from "./supabaseSetupSql";
import { supabaseSyncClient } from "./supabaseSyncClient";

const SUPABASE_URL = "https://team.supabase.co";
const ANON_KEY = "anon-key";

function mockJsonResponse(payload: unknown, ok = true): Response {
  return new Response(JSON.stringify(payload), {
    status: ok ? 200 : 400,
    headers: { "content-type": "application/json" },
  });
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
      .mockResolvedValue(mockJsonResponse(1));

    await expect(
      supabaseSyncClient.verifySetup({
        supabaseUrl: SUPABASE_URL,
        anonKey: ANON_KEY,
      })
    ).resolves.toEqual({ ok: true, schemaVersion: 1, missing: [] });

    expect(fetchMock).toHaveBeenCalledWith(
      `${SUPABASE_URL}/rest/v1/rpc/orgii_sync_version`,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("builds create org RPC requests with local Supabase profile fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        org: {
          id: "org-1",
          name: "Team Alpha",
          syncBackend: "supabase",
          supabaseUrl: SUPABASE_URL,
          supabaseAnonKey: ANON_KEY,
          orgSecret: "secret-1",
          createdAt: "2026-06-16T00:00:00.000Z",
        },
        member: {
          id: "member-1",
          orgId: "org-1",
          displayName: "Ada",
          avatar: { initials: "A", variant: "v" },
          role: "admin",
          identityKind: "human",
          joinedAt: "2026-06-16T00:00:00.000Z",
        },
      })
    );

    await supabaseSyncClient.createOrg({
      supabaseUrl: `${SUPABASE_URL}/`,
      anonKey: ANON_KEY,
      orgSecret: "secret-1",
      name: "Team Alpha",
      displayName: "Ada",
      identityKind: COLLAB_IDENTITY_KIND.HUMAN,
    });

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)
    ) as Record<string, unknown>;
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${SUPABASE_URL}/rest/v1/rpc/orgii_create_org`
    );
    expect(body.org_name).toBe("Team Alpha");
    expect(body.payload).toMatchObject({
      syncBackend: "supabase",
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON_KEY,
      orgSecret: "secret-1",
    });
  });

  it("upsertSessionEvents uploads blob and calls RPC with content hash", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => mockJsonResponse(null));

    const events = [
      { id: "evt-1", sessionId: "session-1", chunk_id: null },
    ] as unknown as import("@src/engines/SessionCore/core/types").SessionEvent[];

    await supabaseSyncClient.upsertSessionEvents({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      orgSecret: "secret-1",
      orgId: "org-1",
      sourceSessionId: "session-1",
      events,
    });

    const calls = fetchMock.mock.calls;
    const storageCall = calls.find(
      ([url]) => typeof url === "string" && url.includes("/storage/v1/object/")
    );
    const rpcCall = calls.find(
      ([url]) =>
        typeof url === "string" &&
        url.includes("/rpc/orgii_upsert_session_events")
    );
    expect(storageCall).toBeDefined();
    expect(rpcCall).toBeDefined();

    const storageUrl = String(storageCall?.[0]);
    expect(storageUrl).toContain(
      `${SUPABASE_URL}/storage/v1/object/orgii-session-snapshots/orgs/org-1/sessions/session-1/latest-`
    );
    expect(storageUrl).toMatch(/latest-[a-f0-9]{64}\.json$/);

    const rpcBody = JSON.parse(
      String((rpcCall?.[1] as RequestInit).body)
    ) as Record<string, unknown>;
    expect(rpcBody.org_secret).toBe("secret-1");
    expect(rpcBody.org_id).toBe("org-1");
    expect(rpcBody.source_session_id).toBe("session-1");
    expect(typeof rpcBody.blob_path).toBe("string");
    expect(typeof rpcBody.content_hash).toBe("string");
  });

  it("getSessionEvents returns ref when RPC reports blob path", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        blobPath: "orgs/org-1/sessions/session-1/latest-abc.json",
        contentHash: "abc",
        updatedAt: "2026-07-01T00:00:00.000Z",
      })
    );

    await expect(
      supabaseSyncClient.getSessionEvents({
        supabaseUrl: SUPABASE_URL,
        anonKey: ANON_KEY,
        orgSecret: "secret-1",
        orgId: "org-1",
        sourceSessionId: "session-1",
      })
    ).resolves.toEqual({
      blobPath: "orgs/org-1/sessions/session-1/latest-abc.json",
      contentHash: "abc",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
  });

  it("getSessionEvents returns null when RPC reports null blob", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockJsonResponse(null));

    await expect(
      supabaseSyncClient.getSessionEvents({
        supabaseUrl: SUPABASE_URL,
        anonKey: ANON_KEY,
        orgSecret: "secret-1",
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

  it("updateOrgRepoScopes calls RPC with repo_scopes array", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse(null));

    await supabaseSyncClient.updateOrgRepoScopes({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      orgSecret: "secret-1",
      orgId: "org-1",
      repoScopes: ["/repos/foo", "/repos/bar"],
    });

    const rpcCall = fetchMock.mock.calls.find(
      ([url]) =>
        typeof url === "string" &&
        url.includes("/rpc/orgii_update_org_repo_scopes")
    );
    expect(rpcCall).toBeDefined();
    const body = JSON.parse(
      String((rpcCall?.[1] as RequestInit).body)
    ) as Record<string, unknown>;
    expect(body.org_secret).toBe("secret-1");
    expect(body.org_id).toBe("org-1");
    expect(body.repo_scopes).toEqual(["/repos/foo", "/repos/bar"]);
  });

  it("requestRepoJoin calls RPC with requester member id and repo path", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse(null));

    await supabaseSyncClient.requestRepoJoin({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      orgSecret: "secret-1",
      orgId: "org-1",
      repoPath: "/repos/foo",
      requesterMemberId: "member-1",
    });

    const rpcCall = fetchMock.mock.calls.find(
      ([url]) =>
        typeof url === "string" && url.includes("/rpc/orgii_request_repo_join")
    );
    expect(rpcCall).toBeDefined();
    const body = JSON.parse(
      String((rpcCall?.[1] as RequestInit).body)
    ) as Record<string, unknown>;
    expect(body.org_id).toBe("org-1");
    expect(body.repo_path).toBe("/repos/foo");
    expect(body.requester_member_id).toBe("member-1");
    expect(body.payload).toMatchObject({ status: "pending" });
  });

  it("reviewRepoJoin calls RPC with approve flag and reviewer", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse(null));

    await supabaseSyncClient.reviewRepoJoin({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      orgSecret: "secret-1",
      requestId: "req-1",
      approve: true,
      reviewerMemberId: "admin-1",
      reviewNote: "looks good",
    });

    const rpcCall = fetchMock.mock.calls.find(
      ([url]) =>
        typeof url === "string" && url.includes("/rpc/orgii_review_repo_join")
    );
    expect(rpcCall).toBeDefined();
    const body = JSON.parse(
      String((rpcCall?.[1] as RequestInit).body)
    ) as Record<string, unknown>;
    expect(body.request_id).toBe("req-1");
    expect(body.approve).toBe(true);
    expect(body.reviewer_member_id).toBe("admin-1");
    expect(body.review_note).toBe("looks good");
  });

  it("listOrgState passes sinceTimestamp and returns repoJoinRequests", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        orgs: [],
        members: [],
        invites: [],
        projects: [],
        workItems: [],
        sessions: [],
        chatMessages: [],
        repoJoinRequests: [
          {
            requestId: "req-1",
            orgId: "org-1",
            requesterMemberId: "member-2",
            repoPath: "/repos/foo",
            status: "pending",
            createdAt: "2026-07-01T00:00:00.000Z",
          },
        ],
        snapshotRequests: [],
      })
    );

    const result = await supabaseSyncClient.listOrgState({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      orgSecret: "secret-1",
      orgId: "org-1",
      sinceTimestamp: "2026-06-01T00:00:00.000Z",
    });

    expect(result.repoJoinRequests).toHaveLength(1);
    expect(result.repoJoinRequests[0]?.repoPath).toBe("/repos/foo");
  });
});
