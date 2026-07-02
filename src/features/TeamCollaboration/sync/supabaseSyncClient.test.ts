import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { COLLAB_IDENTITY_KIND } from "@src/store/collaboration/types";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";

import { sha256Hex } from "../collabSyncUtils";
import {
  computeSegmentHash,
  gunzipBase64ToJson,
  gzipJsonToBase64,
} from "./collabGzip";
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
  eventsEpoch: undefined,
  eventsFrozenSeq: undefined,
  eventsCount: undefined,
  eventsTailHash: undefined,
};

function makeEvent(id: string): SessionEvent {
  return { id, sessionId: "session-1", chunk_id: null } as SessionEvent;
}

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

  it("declares the segments data plane RPCs and table", () => {
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_session_event_segments");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_append_session_events");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_rewrite_session_events");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "orgii_get_session_event_segments"
    );
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "orgii_gc_session_event_segments"
    );
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("payload_gz");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("events_epoch");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("events_frozen_seq");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("events_tail_hash");
  });

  it("retires the blob-era events RPCs and the Storage policies", () => {
    // Drops stay (re-runs purge live DBs), creates and grants are gone.
    expect(ORGII_SUPABASE_SETUP_SQL).not.toContain(
      "create or replace function public.orgii_upsert_session_events"
    );
    expect(ORGII_SUPABASE_SETUP_SQL).not.toContain(
      "create or replace function public.orgii_get_session_events("
    );
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "drop function if exists public.orgii_upsert_session_events"
    );
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "drop column if exists events_blob_path"
    );
    // Anon bucket policies are dropped and never recreated (bucket retired).
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "drop policy if exists orgii_snapshots_anon_read"
    );
    expect(ORGII_SUPABASE_SETUP_SQL).not.toContain(
      "create policy orgii_snapshots_anon_read"
    );
    expect(ORGII_SUPABASE_SETUP_SQL).not.toContain("/storage/v1/");
  });

  it("declares repo scope RPCs and tables", () => {
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_update_org_repo_scopes");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_request_repo_join");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_review_repo_join");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_repo_join_requests");
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

  it("declares the sharing plane (M4): shares table, RPCs, visibility filter", () => {
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_session_shares");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_create_session_share");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_revoke_session_share");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_list_session_shares");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_resolve_session_share");
    // Sessions columns + the SQL-side visibility boundary (design §6.5).
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "add column if not exists visibility text"
    );
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "add column if not exists replay_level text"
    );
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "coalesce(s.visibility, 'org') = 'org'"
    );
    // Token auth reaches the segments read; the M3 signature is dropped.
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("p_share_token");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "drop function if exists public.orgii_get_session_event_segments(text, text, integer, text, text, text);"
    );
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "grant execute on function public.orgii_get_session_event_segments(text, text, integer, text, text, text, text) to anon;"
    );
  });

  it("declares the M6 project/work-item collab RPCs: allocator + execution lock", () => {
    // Short-id allocator (§16.5): server-owned counter, atomic
    // update-returning, uniform conflict on missing/tombstoned project.
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "orgii_allocate_work_item_short_id"
    );
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "next_work_item_id = next_work_item_id + 1"
    );
    // Execution lock (§16.6): OCC acquire only while unlocked; holder
    // forced to the authenticated member; release holder/admin-gated.
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_acquire_work_item_lock");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("orgii_release_work_item_lock");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("{executionLock}");
    expect(ORGII_SUPABASE_SETUP_SQL).toContain("lockedByMemberId");
    // Grants + drop-before-create discipline.
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "grant execute on function public.orgii_allocate_work_item_short_id(text, text, text, text, text) to anon;"
    );
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "grant execute on function public.orgii_acquire_work_item_lock(text, text, jsonb, text, text, text) to anon;"
    );
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "grant execute on function public.orgii_release_work_item_lock(text, text, text, text, text) to anon;"
    );
    expect(ORGII_SUPABASE_SETUP_SQL).toContain(
      "drop function if exists public.orgii_allocate_work_item_short_id(text, text, text, text, text);"
    );
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

  it("verifySetup flags a server schema newer than the client as serverNewer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockJsonResponse(3));

    // Design §10: server newer than client is a distinct state ("upgrade
    // the app"), not the generic setup-missing error.
    await expect(
      supabaseSyncClient.verifySetup({
        supabaseUrl: SUPABASE_URL,
        anonKey: ANON_KEY,
      })
    ).resolves.toEqual({
      ok: false,
      serverNewer: true,
      schemaVersion: 3,
      missing: [],
    });
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

  it("appendSessionEvents sends gzipped base64 segments through the member-only RPC", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => mockJsonResponse(null));

    const frozenEvents = [makeEvent("evt-1"), makeEvent("evt-2")];
    const tailEvents = [makeEvent("evt-3")];

    await supabaseSyncClient.appendSessionEvents({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      sessionRowId: "org-1:member-1:session-1",
      expectedEpoch: 3,
      expectedFrozenSeq: 7,
      frozenSegments: [{ seq: 8, events: frozenEvents }],
      tail: tailEvents,
      totalCount: 3,
    });

    // Everything travels through the RPC — the Storage bucket is retired.
    expect(
      fetchMock.mock.calls.some(
        ([url]) => typeof url === "string" && url.includes("/storage/")
      )
    ).toBe(false);

    const body = getRpcBody(fetchMock, "orgii_append_session_events");
    expect(body.p_org_id).toBe("org-1");
    expect(body.p_member_id).toBe("member-1");
    expect(body.p_member_token).toBe("member-token-1");
    expect(body).not.toHaveProperty("p_org_secret");
    expect(body.session_row_id).toBe("org-1:member-1:session-1");
    expect(body.expected_epoch).toBe(3);
    expect(body.expected_frozen_seq).toBe(7);
    expect(body.total_count).toBe(3);

    const segments = body.frozen_segments as Array<Record<string, unknown>>;
    expect(segments).toHaveLength(1);
    expect(segments[0].seq).toBe(8);
    expect(segments[0].eventCount).toBe(2);
    expect(segments[0].segmentHash).toBe(
      await computeSegmentHash(frozenEvents)
    );
    // payloadGz round-trips through gzip+base64 back to the events.
    await expect(
      gunzipBase64ToJson(String(segments[0].payloadGz))
    ).resolves.toEqual(frozenEvents);

    const tail = body.tail as Record<string, unknown>;
    expect(tail.eventCount).toBe(1);
    expect(tail.segmentHash).toBe(await computeSegmentHash(tailEvents));
    await expect(gunzipBase64ToJson(String(tail.payloadGz))).resolves.toEqual(
      tailEvents
    );
  });

  it("appendSessionEvents sends a null tail for fully frozen streams", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => mockJsonResponse(null));

    await supabaseSyncClient.appendSessionEvents({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      sessionRowId: "org-1:member-1:session-1",
      expectedEpoch: 1,
      expectedFrozenSeq: 0,
      frozenSegments: [{ seq: 1, events: [makeEvent("evt-1")] }],
      tail: null,
      totalCount: 1,
    });

    const body = getRpcBody(fetchMock, "orgii_append_session_events");
    expect(body.tail).toBeNull();
  });

  it("rewriteSessionEvents carries the new epoch and full segment set", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => mockJsonResponse(null));

    const frozenEvents = [makeEvent("evt-1")];
    await supabaseSyncClient.rewriteSessionEvents({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      sessionRowId: "org-1:member-1:session-1",
      newEpoch: 4,
      frozenSegments: [{ seq: 1, events: frozenEvents }],
      tail: [makeEvent("evt-2")],
      totalCount: 2,
    });

    const body = getRpcBody(fetchMock, "orgii_rewrite_session_events");
    expect(body.new_epoch).toBe(4);
    expect(body.total_count).toBe(2);
    const segments = body.frozen_segments as Array<Record<string, unknown>>;
    expect(segments[0].seq).toBe(1);
    await expect(
      gunzipBase64ToJson(String(segments[0].payloadGz))
    ).resolves.toEqual(frozenEvents);
  });

  it("getSessionEventSegments decodes base64 gzip payloads and passes after_seq", async () => {
    const frozenEvents = [makeEvent("evt-4")];
    const tailEvents = [makeEvent("evt-5")];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        epoch: 2,
        frozenSeq: 4,
        tailHash: "tail-hash",
        count: 9,
        segments: [
          {
            seq: 4,
            isTail: false,
            payloadGz: await gzipJsonToBase64(frozenEvents),
            eventCount: 1,
            segmentHash: "hash-4",
          },
          {
            seq: 1000000000,
            isTail: true,
            payloadGz: await gzipJsonToBase64(tailEvents),
            eventCount: 1,
            segmentHash: "tail-hash",
          },
        ],
      })
    );

    const snapshot = await supabaseSyncClient.getSessionEventSegments({
      ...ROOT_PROFILE,
      orgId: "org-1",
      sessionRowId: "org-1:member-1:session-1",
      afterSeq: 3,
    });

    const body = getRpcBody(fetchMock, "orgii_get_session_event_segments");
    expect(body.p_org_id).toBe("org-1");
    expect(body.p_org_secret).toBe("secret-1");
    expect(body.session_row_id).toBe("org-1:member-1:session-1");
    expect(body.after_seq).toBe(3);

    expect(snapshot.epoch).toBe(2);
    expect(snapshot.frozenSeq).toBe(4);
    expect(snapshot.tailHash).toBe("tail-hash");
    expect(snapshot.count).toBe(9);
    expect(snapshot.segments).toHaveLength(2);
    expect(snapshot.segments[0].events).toEqual(frozenEvents);
    expect(snapshot.segments[1].isTail).toBe(true);
    expect(snapshot.segments[1].events).toEqual(tailEvents);
  });

  it("getSessionEventSegments maps a summary-less session to null fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        epoch: null,
        frozenSeq: null,
        tailHash: null,
        count: null,
        segments: [],
      })
    );

    await expect(
      supabaseSyncClient.getSessionEventSegments({
        ...MEMBER_PROFILE,
        orgId: "org-1",
        sessionRowId: "org-1:member-1:session-1",
      })
    ).resolves.toEqual({
      epoch: null,
      frozenSeq: null,
      tailHash: null,
      count: null,
      segments: [],
    });
  });

  it("removed blob-era client methods are gone", () => {
    const client = supabaseSyncClient as unknown as Record<string, unknown>;
    expect(client.upsertSessionEvents).toBeUndefined();
    expect(client.getSessionEvents).toBeUndefined();
    expect(client.downloadSessionEventsBlob).toBeUndefined();
  });

  it("publishSessionSnapshot inlines the gzipped payload into the RPC", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => mockJsonResponse(null));

    const events = [makeEvent("evt-1")];
    await supabaseSyncClient.publishSessionSnapshot({
      ...MEMBER_PROFILE,
      requestId: "req-1",
      orgId: "org-1",
      sourceSessionId: "session-1",
      session: REMOTE_SESSION,
      events,
    });

    expect(
      fetchMock.mock.calls.some(
        ([url]) => typeof url === "string" && url.includes("/storage/")
      )
    ).toBe(false);
    const body = getRpcBody(fetchMock, "orgii_create_session_snapshot");
    expect(body.request_id).toBe("req-1");
    expect(body).not.toHaveProperty("blob_path");
    expect(body).not.toHaveProperty("content_hash");
    const decoded = (await gunzipBase64ToJson(String(body.payload_gz))) as {
      session: unknown;
      events: unknown;
    };
    expect(decoded.events).toEqual(events);
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

  it("listOrgState passes since_timestamp and surfaces serverTime, segment summaries and tombstones", async () => {
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
            eventsEpoch: null,
            eventsFrozenSeq: null,
            eventsCount: null,
            eventsTailHash: null,
            deletedAt: "2026-07-01T11:00:00.000Z",
          },
          {
            ...REMOTE_SESSION,
            id: "org-1:member-2:session-2",
            ownerMemberId: "member-2",
            ownerUserId: "member-2",
            sourceSessionId: "session-2",
            eventsEpoch: 2,
            eventsFrozenSeq: 5,
            eventsCount: 42,
            eventsTailHash: "tail-hash",
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
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0]?.deletedAt).toBe("2026-07-01T11:00:00.000Z");
    expect(result.sessions[1]).toMatchObject({
      eventsEpoch: 2,
      eventsFrozenSeq: 5,
      eventsCount: 42,
      eventsTailHash: "tail-hash",
    });
    expect(result.repoJoinRequests).toHaveLength(1);
    expect(result.repoJoinRequests[0]?.repoPath).toBe("/repos/foo");
  });

  it("listOrgState gunzips inline snapshot payloads", async () => {
    const events = [makeEvent("evt-1")];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        serverTime: "2026-07-01T12:00:00.000Z",
        orgs: [],
        members: [],
        invites: [],
        projects: [],
        workItems: [],
        sessions: [],
        chatMessages: [],
        repoJoinRequests: [],
        snapshotRequests: [
          {
            requestId: "req-1",
            orgId: "org-1",
            requesterMemberId: "member-1",
            ownerMemberId: "member-2",
            sourceSessionId: "session-2",
            status: "completed",
            createdAt: "2026-07-01T00:00:00.000Z",
            payloadGz: await gzipJsonToBase64({
              session: {
                ...REMOTE_SESSION,
                id: "org-1:member-2:session-2",
                ownerMemberId: "member-2",
                ownerUserId: "member-2",
                sourceSessionId: "session-2",
              },
              events,
            }),
          },
        ],
      })
    );

    const result = await supabaseSyncClient.listOrgState({
      ...MEMBER_PROFILE,
      orgId: "org-1",
    });

    expect(result.snapshotRequests).toHaveLength(1);
    expect(result.snapshotRequests[0]?.status).toBe("completed");
    expect(result.snapshotRequests[0]?.session?.sourceSessionId).toBe(
      "session-2"
    );
    expect(result.snapshotRequests[0]?.events).toEqual(events);
  });

  it("listOrgState tolerates pending snapshot requests with null session/events", async () => {
    // The server LEFT JOINs snapshots onto requests, so a pending/denied
    // request returns session:null and events:null. Parsing must not throw —
    // a throw here would wedge the org's sync permanently (cursor never
    // advances past the failing pull).
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        serverTime: "2026-07-01T12:00:00.000Z",
        orgs: [],
        members: [],
        invites: [],
        projects: [],
        workItems: [],
        sessions: [],
        chatMessages: [],
        repoJoinRequests: [],
        snapshotRequests: [
          {
            requestId: "req-pending",
            orgId: "org-1",
            requesterMemberId: "member-1",
            ownerMemberId: "member-2",
            sourceSessionId: "session-2",
            status: "pending",
            error: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            payloadGz: null,
            session: null,
            events: null,
          },
        ],
      })
    );

    const result = await supabaseSyncClient.listOrgState({
      ...MEMBER_PROFILE,
      orgId: "org-1",
    });

    expect(result.snapshotRequests).toHaveLength(1);
    expect(result.snapshotRequests[0]?.status).toBe("pending");
    expect(result.snapshotRequests[0]?.session).toBeUndefined();
    expect(result.snapshotRequests[0]?.events).toBeUndefined();
  });

  it("gcSessionEventSegments calls the retention RPC with a default of 90 days", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse(7));

    await expect(
      supabaseSyncClient.gcSessionEventSegments({
        ...ROOT_PROFILE,
        orgId: "org-1",
      })
    ).resolves.toBe(7);

    const body = getRpcBody(fetchMock, "orgii_gc_session_event_segments");
    expect(body.p_org_id).toBe("org-1");
    expect(body.retention_days).toBe(90);
  });

  it("createSessionShare (link) generates a token locally and sends only its hash", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse("share-1"));

    const result = await supabaseSyncClient.createSessionShare({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      sessionRowId: "org-1:member-1:session-1",
      level: "replay",
    });

    expect(result.shareId).toBe("share-1");
    // 32-byte token, plaintext only in the local result.
    expect(result.shareToken).toMatch(/^[a-f0-9]{64}$/);

    const body = getRpcBody(fetchMock, "orgii_create_session_share");
    expect(body.p_org_id).toBe("org-1");
    expect(body.p_member_id).toBe("member-1");
    expect(body.p_member_token).toBe("member-token-1");
    expect(body.session_row_id).toBe("org-1:member-1:session-1");
    expect(body.grantee_member_id).toBeNull();
    expect(body.level).toBe("replay");
    expect(body.expires_at).toBeNull();
    expect(body.share_token_hash).toBe(await sha256Hex(result.shareToken!));
    // The plaintext token never appears anywhere in the request body.
    expect(JSON.stringify(body)).not.toContain(result.shareToken);
  });

  it("createSessionShare (directed) sends the grantee and no token at all", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse("share-2"));

    const result = await supabaseSyncClient.createSessionShare({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      sessionRowId: "org-1:member-1:session-1",
      granteeMemberId: "member-2",
      level: "metadata",
      expiresAt: "2026-08-01T00:00:00.000Z",
    });

    expect(result).toEqual({ shareId: "share-2", shareToken: undefined });

    const body = getRpcBody(fetchMock, "orgii_create_session_share");
    expect(body.grantee_member_id).toBe("member-2");
    expect(body.share_token_hash).toBeNull();
    expect(body.level).toBe("metadata");
    expect(body.expires_at).toBe("2026-08-01T00:00:00.000Z");
  });

  it("revokeSessionShare calls the RPC with the share id", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse(null));

    await supabaseSyncClient.revokeSessionShare({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      shareId: "share-1",
    });

    const body = getRpcBody(fetchMock, "orgii_revoke_session_share");
    expect(body.p_org_id).toBe("org-1");
    expect(body.p_member_id).toBe("member-1");
    expect(body.share_id).toBe("share-1");
  });

  it("listSessionShares parses the owner listing (token hashes never present)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse([
        {
          id: "share-1",
          granteeMemberId: "member-2",
          level: "replay",
          expiresAt: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          revokedAt: null,
          hasToken: false,
        },
        {
          id: "share-2",
          granteeMemberId: null,
          level: "metadata",
          expiresAt: "2026-08-01T00:00:00.000Z",
          createdAt: "2026-07-01T00:00:00.000Z",
          revokedAt: "2026-07-02T00:00:00.000Z",
          hasToken: true,
        },
      ])
    );

    const shares = await supabaseSyncClient.listSessionShares({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      sessionRowId: "org-1:member-1:session-1",
    });

    const body = getRpcBody(fetchMock, "orgii_list_session_shares");
    expect(body.session_row_id).toBe("org-1:member-1:session-1");
    expect(body.p_member_id).toBe("member-1");

    expect(shares).toEqual([
      {
        id: "share-1",
        granteeMemberId: "member-2",
        level: "replay",
        expiresAt: undefined,
        createdAt: "2026-07-01T00:00:00.000Z",
        revokedAt: undefined,
        hasToken: false,
      },
      {
        id: "share-2",
        granteeMemberId: undefined,
        level: "metadata",
        expiresAt: "2026-08-01T00:00:00.000Z",
        createdAt: "2026-07-01T00:00:00.000Z",
        revokedAt: "2026-07-02T00:00:00.000Z",
        hasToken: true,
      },
    ]);
  });

  it("resolveSessionShare works with only supabaseUrl + anonKey + token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        ...REMOTE_SESSION,
        visibility: "restricted",
        replayLevel: "replay",
        eventsEpoch: 1,
        eventsFrozenSeq: 2,
        eventsCount: 3,
        eventsTailHash: "tail-hash",
      })
    );

    const session = await supabaseSyncClient.resolveSessionShare({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      shareToken: "plain-share-token",
    });

    // Ticket tier: the token is the whole request body — no member identity,
    // no org secret, and the token itself travels only to this single RPC.
    const body = getRpcBody(fetchMock, "orgii_resolve_session_share");
    expect(body).toEqual({ share_token: "plain-share-token" });

    expect(session.id).toBe("org-1:member-1:session-1");
    expect(session.visibility).toBe("restricted");
    expect(session.replayLevel).toBe("replay");
    expect(session.eventsEpoch).toBe(1);
  });

  it("getSessionEventSegments with a share token sends no member/root credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        epoch: 1,
        frozenSeq: 1,
        tailHash: null,
        count: 1,
        segments: [],
      })
    );

    await supabaseSyncClient.getSessionEventSegments({
      // Even with a full credentialed profile, the token path must not put
      // member or root credentials on the wire.
      ...FULL_PROFILE,
      orgId: "org-1",
      sessionRowId: "org-1:member-1:session-1",
      shareToken: "plain-share-token",
      afterSeq: 2,
    });

    const body = getRpcBody(fetchMock, "orgii_get_session_event_segments");
    expect(body.p_share_token).toBe("plain-share-token");
    expect(body.after_seq).toBe(2);
    expect(body).not.toHaveProperty("p_member_id");
    expect(body).not.toHaveProperty("p_member_token");
    expect(body).not.toHaveProperty("p_org_secret");
  });

  it("upsertWorkItem sends the OCC base version and returns the new server version", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse({ id: "AAA-0001", version: 4 }));

    const result = await supabaseSyncClient.upsertWorkItem({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      workItem: { id: "AAA-0001", title: "T" },
      baseVersion: 3,
    });

    const body = getRpcBody(fetchMock, "orgii_upsert_work_item");
    expect(body.p_org_id).toBe("org-1");
    expect(body.base_version).toBe(3);
    expect(body.work_item).toEqual({ id: "AAA-0001", title: "T" });
    expect(result).toEqual({ id: "AAA-0001", version: 4 });
  });

  it("upsertProjectMetadata returns the new server version (never-synced base is null)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse({ id: "p-1", version: 1 }));

    const result = await supabaseSyncClient.upsertProjectMetadata({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      project: { id: "p-1", name: "P" },
      baseVersion: null,
    });

    const body = getRpcBody(fetchMock, "orgii_upsert_project");
    expect(body.base_version).toBeNull();
    expect(result).toEqual({ id: "p-1", version: 1 });
  });

  it("delete RPCs send the entity id under the RPC's parameter name", async () => {
    // A Response body is single-read: mint a fresh one per call.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => mockJsonResponse(null));

    await supabaseSyncClient.deleteWorkItemMetadata({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      workItemId: "AAA-0001",
    });
    await supabaseSyncClient.deleteProjectMetadata({
      ...ROOT_PROFILE,
      orgId: "org-1",
      projectId: "p-1",
    });

    expect(getRpcBody(fetchMock, "orgii_delete_work_item").work_item_id).toBe(
      "AAA-0001"
    );
    const projectBody = getRpcBody(fetchMock, "orgii_delete_project");
    expect(projectBody.project_id).toBe("p-1");
    expect(projectBody.p_org_secret).toBe("secret-1");
  });

  it("allocateWorkItemShortId parses the server-allocated id (§16.5)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJsonResponse({ shortId: "AUT-0007", n: 7 }));

    const allocated = await supabaseSyncClient.allocateWorkItemShortId({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      projectId: "p-1",
    });

    const body = getRpcBody(fetchMock, "orgii_allocate_work_item_short_id");
    expect(body.p_org_id).toBe("org-1");
    expect(body.project_id).toBe("p-1");
    expect(body.p_member_id).toBe("member-1");
    expect(allocated).toEqual({ shortId: "AUT-0007", n: 7 });
  });

  it("acquire/release work item lock round-trip the row version (§16.6)", async () => {
    // A Response body is single-read: mint a fresh one per call.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => mockJsonResponse(5));

    const acquired = await supabaseSyncClient.acquireWorkItemLock({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      workItemId: "AAA-0001",
      lockPayload: { activeSessionId: "session-9" },
    });
    const released = await supabaseSyncClient.releaseWorkItemLock({
      ...MEMBER_PROFILE,
      orgId: "org-1",
      workItemId: "AAA-0001",
    });

    const acquireBody = getRpcBody(fetchMock, "orgii_acquire_work_item_lock");
    expect(acquireBody.work_item_id).toBe("AAA-0001");
    expect(acquireBody.lock_payload).toEqual({ activeSessionId: "session-9" });
    const releaseBody = getRpcBody(fetchMock, "orgii_release_work_item_lock");
    expect(releaseBody.work_item_id).toBe("AAA-0001");
    expect(acquired).toBe(5);
    expect(released).toBe(5);
  });
});
