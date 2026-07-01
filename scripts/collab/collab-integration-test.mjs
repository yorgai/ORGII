// Integration test for the ORGII collaboration schema v2 (Supabase).
//
// Runs the full RPC-surface acceptance suite from
// docs/architecture/session-sharing-v2-design-0701.md §13 M1 against a REAL
// Supabase project, using only the anon key — the same trust surface a
// production client (or an attacker) has.
//
// Usage:
//   1. Create a throwaway Supabase project (never one with real data).
//   2. Paste scripts/collab/setup-v2.sql into its SQL Editor and Run.
//   3. ORGII_TEST_SUPABASE_URL=https://xxx.supabase.co \
//      ORGII_TEST_ANON_KEY=eyJ... \
//      node scripts/collab/collab-integration-test.mjs
//
// Each run creates a fresh org (unique ids); the test DB accumulates them.
// To wipe between runs, paste in the SQL Editor:
//   truncate orgii_orgs cascade;

import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

const SUPABASE_URL = process.env.ORGII_TEST_SUPABASE_URL?.replace(/\/+$/, "");
const ANON_KEY = process.env.ORGII_TEST_ANON_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error(
    "Set ORGII_TEST_SUPABASE_URL and ORGII_TEST_ANON_KEY (throwaway project only)."
  );
  process.exit(2);
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const randomHex = (bytes = 32) => randomBytes(bytes).toString("hex");
const nowIso = () => new Date().toISOString();

async function rpc(name, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${ANON_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: response.ok, status: response.status, json };
}

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${pass || !detail ? "" : ` — ${detail}`}`);
}

function assertOk(name, res, extra = () => true, detail = "") {
  const pass = res.ok && extra(res.json);
  record(name, pass, pass ? "" : detail || `status=${res.status} body=${JSON.stringify(res.json)?.slice(0, 200)}`);
  return pass;
}

function assertError(name, res, code) {
  const message = res.json?.message ?? "";
  const pass = !res.ok && message.includes(code);
  record(name, pass, pass ? "" : `expected ${code}, got status=${res.status} message=${message}`);
  return pass;
}

const run = randomHex(4);
const memberPayload = (id, orgId, displayName, role) => ({
  id,
  orgId,
  displayName,
  avatar: { initials: displayName.slice(0, 2).toUpperCase(), variant: "v" },
  role,
  identityKind: "human",
  joinedAt: nowIso(),
});

async function main() {
  console.log(`\nORGII collab schema v2 integration test (run ${run})\n`);

  // ---- setup: version ----
  const version = await rpc("orgii_sync_version", {});
  assertOk("schema version >= 2", version, (v) => Number(v) >= 2, `got ${version.json}`);

  // ---- org + creator (admin A) ----
  const orgId = `org-it-${run}`;
  const orgSecret = randomHex();
  const aId = `member-a-${run}`;
  const aToken = randomHex();
  const created = await rpc("orgii_create_org", {
    org_name: `IT Org ${run}`,
    display_name: "Admin A",
    identity_kind: "human",
    org_secret_hash: sha256(orgSecret),
    member_credential_hash: sha256(aToken),
    payload: {
      id: orgId,
      name: `IT Org ${run}`,
      // deliberately try to smuggle secrets — server must strip them
      orgSecret: "SHOULD_NOT_PERSIST",
      supabaseAnonKey: "SHOULD_NOT_PERSIST",
      createdAt: nowIso(),
    },
    member_payload: memberPayload(aId, orgId, "Admin A", "admin"),
  });
  assertOk("create_org succeeds", created, (j) => j?.org?.id === orgId);
  record(
    "org payload strips orgSecret/anonKey on write",
    created.json?.org?.orgSecret === undefined &&
      created.json?.org?.supabaseAnonKey === undefined
  );

  const memberAuthA = { p_member_id: aId, p_member_token: aToken };
  const rootAuth = { p_org_secret: orgSecret };

  // ---- credential discipline ----
  assertError(
    "both credentials at once rejected",
    await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA, ...rootAuth }),
    "ORGII_UNAUTHORIZED"
  );
  assertError(
    "no credential rejected",
    await rpc("orgii_list_org_state", { p_org_id: orgId }),
    "ORGII_UNAUTHORIZED"
  );
  assertError(
    "wrong member token rejected",
    await rpc("orgii_list_org_state", { p_org_id: orgId, p_member_id: aId, p_member_token: randomHex() }),
    "ORGII_UNAUTHORIZED"
  );
  assertOk(
    "root secret works",
    await rpc("orgii_list_org_state", { p_org_id: orgId, ...rootAuth }),
    (j) => Array.isArray(j?.members)
  );

  // ---- invites: single-use, display-only, exhausted != credential ----
  const inviteCode = randomHex();
  const inviteRes = await rpc("orgii_create_invite", {
    p_org_id: orgId,
    ...memberAuthA,
    invite_code_hash: sha256(inviteCode),
    usage_limit: 1,
    expires_at: null,
    invite_role: "member",
    payload: { id: `invite-${run}`, orgId, codeSuffix: inviteCode.slice(-4), usageLimit: 1, usageCount: 0, role: "member", createdAt: nowIso() },
  });
  assertOk("admin creates single-use invite", inviteRes, (j) => j?.id === `invite-${run}`);
  record("stored invite payload has no plaintext code", inviteRes.json?.inviteCode === undefined && inviteRes.json?.inviteLink === undefined);

  const bId = `member-b-${run}`;
  const bToken = randomHex();
  assertOk(
    "member B accepts invite",
    await rpc("orgii_accept_invite", {
      invite_code: inviteCode,
      display_name: "Member B",
      identity_kind: "human",
      member_credential_hash: sha256(bToken),
      member_payload: memberPayload(bId, orgId, "Member B", "member"),
    }),
    (j) => j?.member?.id === bId
  );
  assertError(
    "second accept on exhausted invite rejected",
    await rpc("orgii_accept_invite", {
      invite_code: inviteCode,
      display_name: "Freeloader",
      identity_kind: "human",
      member_credential_hash: sha256(randomHex()),
      member_payload: memberPayload(`member-x-${run}`, orgId, "Freeloader", "member"),
    }),
    "ORGII_INVITE_INVALID"
  );
  assertError(
    "exhausted invite code is not a credential (v1 S1/S2 regression)",
    await rpc("orgii_list_org_state", { p_org_id: orgId, p_org_secret: inviteCode }),
    "ORGII_UNAUTHORIZED"
  );

  const memberAuthB = { p_member_id: bId, p_member_token: bToken };
  assertOk(
    "member B token works",
    await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthB }),
    (j) => Array.isArray(j?.members) && j.members.length >= 2
  );

  // ---- visibility: invites admin-only ----
  const bList = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthB });
  record("member B cannot see invites", Array.isArray(bList.json?.invites) && bList.json.invites.length === 0);
  const aList = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA });
  record("admin A sees invite metadata", (aList.json?.invites?.length ?? 0) >= 1);
  record("org payload strips secrets on read", aList.json?.orgs?.[0]?.orgSecret === undefined);

  // ---- role matrix ----
  assertError(
    "member B cannot create invites",
    await rpc("orgii_create_invite", {
      p_org_id: orgId, ...memberAuthB, invite_code_hash: sha256(randomHex()),
      usage_limit: 1, expires_at: null, invite_role: "member", payload: { id: `invite-b-${run}`, orgId },
    }),
    "ORGII_UNAUTHORIZED"
  );
  assertError(
    "member B cannot edit repo scopes",
    await rpc("orgii_update_org_repo_scopes", { p_org_id: orgId, ...memberAuthB, repo_scopes: ["/evil"] }),
    "ORGII_UNAUTHORIZED"
  );

  // ---- repo join: requester forced, self-approval blocked ----
  const joinReq = await rpc("orgii_request_repo_join", {
    p_org_id: orgId, ...memberAuthB, repo_path: `/repo/it-${run}`,
    payload: { requestId: `rj-${run}`, orgId, requesterMemberId: "spoofed", repoPath: `/repo/it-${run}`, status: "pending", createdAt: nowIso() },
  });
  assertOk("member B requests repo join", joinReq, (j) => j?.requesterMemberId === bId, "requester not forced to caller");
  assertError(
    "member B cannot approve own repo join",
    await rpc("orgii_review_repo_join", { p_org_id: orgId, ...memberAuthB, request_id: `rj-${run}`, approve: true, review_note: null }),
    "ORGII_UNAUTHORIZED"
  );
  const reviewed = await rpc("orgii_review_repo_join", { p_org_id: orgId, ...memberAuthA, request_id: `rj-${run}`, approve: true, review_note: "ok" });
  assertOk("admin approves repo join", reviewed, (j) => j?.status === "approved");
  const afterScopes = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA });
  record(
    "approved repo lands in org repoScopes",
    JSON.stringify(afterScopes.json?.orgs?.[0]?.repoScopes ?? []).includes(`/repo/it-${run}`)
  );

  // ---- sessions: owner forced, cross-owner blocked, tombstones ----
  const sourceSessionId = `sess-${run}`;
  assertOk(
    "member B upserts session metadata (spoofed owner in payload)",
    await rpc("orgii_upsert_session_metadata", {
      p_org_id: orgId, ...memberAuthB,
      payload: {
        id: `${orgId}:${bId}:${sourceSessionId}`, orgId, ownerMemberId: aId /* spoof */,
        ownerUserId: bId, ownerDisplayName: "Member B", ownerIdentityKind: "human",
        sourceSessionId, title: "B session", accessMode: "full_replay",
      },
    }),
    () => true
  );
  const sessList = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA });
  const storedSession = (sessList.json?.sessions ?? []).find((s) => s.sourceSessionId === sourceSessionId);
  record("session owner forced to authenticated caller", storedSession?.ownerMemberId === bId, `got ${storedSession?.ownerMemberId}`);

  // ---- event segments (M3): owner scoping, OCC, atomic rewrite, read ----
  const sessionRowId = `${orgId}:${bId}:${sourceSessionId}`;
  const gzB64 = (value) => gzipSync(Buffer.from(JSON.stringify(value))).toString("base64");
  const segmentWire = (seq, events) => ({
    seq, payloadGz: gzB64(events), eventCount: events.length, segmentHash: sha256(JSON.stringify(events)),
  });
  const tailWire = (events) => ({
    payloadGz: gzB64(events), eventCount: events.length, segmentHash: sha256(JSON.stringify(events)),
  });
  const frozen1 = [{ id: `e1-${run}`, sessionId: sourceSessionId, displayStatus: "completed" }];
  const tail1 = [{ id: `e2-${run}`, sessionId: sourceSessionId, displayStatus: "running" }];

  assertError(
    "A cannot rewrite B's event segments",
    await rpc("orgii_rewrite_session_events", {
      p_org_id: orgId, ...memberAuthA, session_row_id: sessionRowId,
      new_epoch: 1, frozen_segments: [segmentWire(1, frozen1)], tail: tailWire(tail1), total_count: 2,
    }),
    "ORGII_UNAUTHORIZED"
  );
  assertOk(
    "B anchors epoch 1 via atomic rewrite",
    await rpc("orgii_rewrite_session_events", {
      p_org_id: orgId, ...memberAuthB, session_row_id: sessionRowId,
      new_epoch: 1, frozen_segments: [segmentWire(1, frozen1)], tail: tailWire(tail1), total_count: 2,
    }),
    () => true
  );
  assertError(
    "stale epoch rewrite rejected (epochs only move forward)",
    await rpc("orgii_rewrite_session_events", {
      p_org_id: orgId, ...memberAuthB, session_row_id: sessionRowId,
      new_epoch: 1, frozen_segments: [], tail: tailWire(tail1), total_count: 1,
    }),
    "ORGII_CONFLICT"
  );
  assertError(
    "append with stale OCC anchors rejected",
    await rpc("orgii_append_session_events", {
      p_org_id: orgId, ...memberAuthB, session_row_id: sessionRowId,
      expected_epoch: 1, expected_frozen_seq: 0, frozen_segments: [], tail: tailWire(tail1), total_count: 2,
    }),
    "ORGII_CONFLICT"
  );
  assertError(
    "A cannot append to B's session",
    await rpc("orgii_append_session_events", {
      p_org_id: orgId, ...memberAuthA, session_row_id: sessionRowId,
      expected_epoch: 1, expected_frozen_seq: 1, frozen_segments: [], tail: tailWire(tail1), total_count: 2,
    }),
    "ORGII_UNAUTHORIZED"
  );
  const frozen2 = [{ id: `e2-${run}`, sessionId: sourceSessionId, displayStatus: "completed" }];
  const tail2 = [{ id: `e3-${run}`, sessionId: sourceSessionId, displayStatus: "running" }];
  assertOk(
    "B appends a frozen segment and replaces the tail",
    await rpc("orgii_append_session_events", {
      p_org_id: orgId, ...memberAuthB, session_row_id: sessionRowId,
      expected_epoch: 1, expected_frozen_seq: 1,
      frozen_segments: [segmentWire(2, frozen2)], tail: tailWire(tail2), total_count: 3,
    }),
    () => true
  );
  const segRead = await rpc("orgii_get_session_event_segments", {
    p_org_id: orgId, ...memberAuthA, session_row_id: sessionRowId, after_seq: 0,
  });
  assertOk(
    "member A reads B's segments snapshot",
    segRead,
    (j) =>
      j?.epoch === 1 && j?.frozenSeq === 2 && j?.count === 3 &&
      (j?.segments ?? []).filter((s) => !s.isTail).length === 2 &&
      (j?.segments ?? []).filter((s) => s.isTail).length === 1
  );
  const firstSegment = (segRead.json?.segments ?? []).find((s) => s.seq === 1);
  record(
    "segment payload gunzips back to the pushed events",
    Boolean(firstSegment) &&
      gunzipSync(Buffer.from(firstSegment.payloadGz, "base64")).toString() === JSON.stringify(frozen1)
  );
  const summaryList = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA });
  const summarySession = (summaryList.json?.sessions ?? []).find((s) => s.sourceSessionId === sourceSessionId);
  record(
    "list_org_state carries the segments summary",
    summarySession?.eventsEpoch === 1 && summarySession?.eventsFrozenSeq === 2 && summarySession?.eventsCount === 3,
    `got ${JSON.stringify({ e: summarySession?.eventsEpoch, f: summarySession?.eventsFrozenSeq, c: summarySession?.eventsCount })}`
  );

  assertOk(
    "admin tombstones B's session",
    await rpc("orgii_remove_session_metadata", {
      p_org_id: orgId, ...memberAuthA, owner_member_id: bId, source_session_id: sourceSessionId,
    }),
    () => true
  );
  const afterDelete = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA });
  const tombstone = (afterDelete.json?.sessions ?? []).find((s) => s.sourceSessionId === sourceSessionId);
  record("tombstone visible in delta with deletedAt", Boolean(tombstone?.deletedAt));
  record("tombstone payload stripped (no title)", tombstone && tombstone.title === undefined);
  assertError(
    "segments unreadable once the session is tombstoned",
    await rpc("orgii_get_session_event_segments", {
      p_org_id: orgId, ...memberAuthA, session_row_id: sessionRowId, after_seq: 0,
    }),
    "ORGII_UNAUTHORIZED"
  );

  // ---- chat: author forced ----
  await rpc("orgii_post_chat_message", {
    p_org_id: orgId, ...memberAuthB,
    payload: { id: `chat-${run}`, orgId, authorMemberId: aId /* spoof */, authorDisplayName: "Member B", authorIdentityKind: "human", body: "hello", createdAt: nowIso() },
  });
  const chatList = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA });
  const chat = (chatList.json?.chatMessages ?? []).find((c) => c.id === `chat-${run}`);
  record("chat author forced to authenticated caller", chat?.authorMemberId === bId, `got ${chat?.authorMemberId}`);

  // ---- projects: OCC ----
  const projectId = `proj-${run}`;
  const p1 = await rpc("orgii_upsert_project", {
    p_org_id: orgId, ...memberAuthB, base_version: null,
    project: { id: projectId, orgId, name: "P", slug: `p-${run}`, status: "in_progress" },
  });
  assertOk("project create returns version 1", p1, (j) => j?.version === 1);
  assertError(
    "stale base_version rejected (OCC)",
    await rpc("orgii_upsert_project", {
      p_org_id: orgId, ...memberAuthB, base_version: 0,
      project: { id: projectId, orgId, name: "P stale" },
    }),
    "ORGII_CONFLICT"
  );
  assertOk(
    "correct base_version bumps to 2",
    await rpc("orgii_upsert_project", {
      p_org_id: orgId, ...memberAuthB, base_version: 1,
      project: { id: projectId, orgId, name: "P v2", slug: `p-${run}`, status: "in_progress" },
    }),
    (j) => j?.version === 2
  );

  // ---- roles: promote, last-admin guard, removal kills token ----
  assertOk(
    "admin promotes B to admin",
    await rpc("orgii_update_member_role", { p_org_id: orgId, ...memberAuthA, target_member_id: bId, new_role: "admin" }),
    () => true
  );
  assertOk(
    "promoted B can now create invites",
    await rpc("orgii_create_invite", {
      p_org_id: orgId, ...memberAuthB, invite_code_hash: sha256(randomHex()),
      usage_limit: 2, expires_at: null, invite_role: "member",
      payload: { id: `invite-b2-${run}`, orgId, codeSuffix: "test", usageLimit: 2, usageCount: 0, role: "member", createdAt: nowIso() },
    }),
    (j) => j?.id === `invite-b2-${run}`
  );
  assertOk(
    "A demotes self (B still admin)",
    await rpc("orgii_update_member_role", { p_org_id: orgId, ...memberAuthA, target_member_id: aId, new_role: "member" }),
    () => true
  );
  assertError(
    "last admin cannot self-demote",
    await rpc("orgii_update_member_role", { p_org_id: orgId, ...memberAuthB, target_member_id: bId, new_role: "member" }),
    "ORGII_LAST_ADMIN"
  );
  assertError(
    "last admin cannot self-remove",
    await rpc("orgii_remove_member", { p_org_id: orgId, ...memberAuthB, target_member_id: bId }),
    "ORGII_LAST_ADMIN"
  );
  assertOk(
    "admin B removes member A",
    await rpc("orgii_remove_member", { p_org_id: orgId, ...memberAuthB, target_member_id: aId }),
    () => true
  );
  assertError(
    "removed member's token is dead",
    await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA }),
    "ORGII_UNAUTHORIZED"
  );
  const finalList = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthB });
  const removedA = (finalList.json?.members ?? []).find((m) => m.id === aId);
  record("removed member tombstone propagates in roster", Boolean(removedA?.removedAt));
  record("serverTime present in list", typeof finalList.json?.serverTime === "string");

  // ---- delta cursor sanity ----
  const future = new Date(Date.now() + 3600_000).toISOString();
  const emptyDelta = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthB, since_timestamp: future });
  record("future since yields empty session delta", (emptyDelta.json?.sessions ?? []).length === 0);

  // ---- summary ----
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.log("Failed:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(2);
});
