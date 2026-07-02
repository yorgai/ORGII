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

  // ---- incremental after_seq filtering (design §7.4 delta pull) ----
  // The consumer that already holds frozen seq 1 pulls with after_seq: 1 and
  // must receive ONLY the newer frozen segment (seq 2) plus the mutable tail —
  // never the frozen seq-1 payload it already has. This proves the server, not
  // the client, does the incremental filtering. The session currently holds
  // frozen seqs 1 and 2 (epoch 1, count 3) from the M3 section above.
  const delta = await rpc("orgii_get_session_event_segments", {
    p_org_id: orgId, ...memberAuthA, session_row_id: sessionRowId, after_seq: 1,
  });
  const deltaFrozen = (delta.json?.segments ?? []).filter((s) => !s.isTail);
  const deltaTail = (delta.json?.segments ?? []).filter((s) => s.isTail);
  assertOk(
    "after_seq: 1 returns only the seq-2 frozen segment + tail",
    delta,
    (j) =>
      j?.epoch === 1 && j?.frozenSeq === 2 && j?.count === 3 &&
      deltaFrozen.length === 1 && deltaFrozen[0]?.seq === 2 &&
      deltaTail.length === 1,
    `got frozen=${JSON.stringify(deltaFrozen.map((s) => s.seq))} tail=${deltaTail.length}`
  );
  record(
    "after_seq: 1 excludes the already-held seq-1 frozen segment",
    !deltaFrozen.some((s) => s.seq === 1)
  );
  const deltaSeg2 = deltaFrozen.find((s) => s.seq === 2);
  record(
    "delta seq-2 payload gunzips back to the second frozen batch",
    Boolean(deltaSeg2) &&
      gunzipSync(Buffer.from(deltaSeg2.payloadGz, "base64")).toString() === JSON.stringify(frozen2)
  );

  // ---- sharing plane (M4): visibility filter, directed + link shares ----
  // Third member C = the non-grantee perspective.
  const cInviteCode = randomHex();
  await rpc("orgii_create_invite", {
    p_org_id: orgId, ...memberAuthA, invite_code_hash: sha256(cInviteCode),
    usage_limit: 1, expires_at: null, invite_role: "member",
    payload: { id: `invite-c-${run}`, orgId, codeSuffix: cInviteCode.slice(-4), usageLimit: 1, usageCount: 0, role: "member", createdAt: nowIso() },
  });
  const cId = `member-c-${run}`;
  const cToken = randomHex();
  assertOk(
    "member C accepts invite",
    await rpc("orgii_accept_invite", {
      invite_code: cInviteCode, display_name: "Member C", identity_kind: "human",
      member_credential_hash: sha256(cToken), member_payload: memberPayload(cId, orgId, "Member C", "member"),
    }),
    (j) => j?.member?.id === cId
  );
  const memberAuthC = { p_member_id: cId, p_member_token: cToken };

  // B pushes a RESTRICTED session with replay segments.
  const restrictedSourceId = `sess-restricted-${run}`;
  const restrictedRowId = `${orgId}:${bId}:${restrictedSourceId}`;
  assertError(
    "invalid visibility value rejected",
    await rpc("orgii_upsert_session_metadata", {
      p_org_id: orgId, ...memberAuthB,
      payload: {
        id: restrictedRowId, orgId, ownerMemberId: bId, ownerUserId: bId,
        ownerDisplayName: "Member B", ownerIdentityKind: "human",
        sourceSessionId: restrictedSourceId, title: "B secret", accessMode: "full_replay",
        visibility: "everyone", replayLevel: "replay",
      },
    }),
    "ORGII_UNAUTHORIZED"
  );
  assertOk(
    "B upserts a restricted session",
    await rpc("orgii_upsert_session_metadata", {
      p_org_id: orgId, ...memberAuthB,
      payload: {
        id: restrictedRowId, orgId, ownerMemberId: bId, ownerUserId: bId,
        ownerDisplayName: "Member B", ownerIdentityKind: "human",
        sourceSessionId: restrictedSourceId, title: "B secret", accessMode: "full_replay",
        visibility: "restricted", replayLevel: "replay",
      },
    }),
    () => true
  );
  const restrictedFrozen = [{ id: `re1-${run}`, sessionId: restrictedSourceId, displayStatus: "completed" }];
  const restrictedTail = [{ id: `re2-${run}`, sessionId: restrictedSourceId, displayStatus: "running" }];
  assertOk(
    "B pushes segments for the restricted session",
    await rpc("orgii_rewrite_session_events", {
      p_org_id: orgId, ...memberAuthB, session_row_id: restrictedRowId,
      new_epoch: 1, frozen_segments: [segmentWire(1, restrictedFrozen)], tail: tailWire(restrictedTail), total_count: 2,
    }),
    () => true
  );

  // Visibility filter (design §6.5): the restricted row reaches owner and
  // root only — not other members, not even member-credentialed admins.
  const cListPre = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthC });
  const preShareTime = cListPre.json?.serverTime;
  record(
    "restricted session invisible to non-grantee member",
    !(cListPre.json?.sessions ?? []).some((s) => s.id === restrictedRowId)
  );
  record(
    "org-visible session still reaches the new member",
    (cListPre.json?.sessions ?? []).some((s) => s.id === sessionRowId)
  );
  const aListShare = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA });
  record(
    "restricted session invisible to member-credentialed admin (not root)",
    !(aListShare.json?.sessions ?? []).some((s) => s.id === restrictedRowId)
  );
  const rootListShare = await rpc("orgii_list_org_state", { p_org_id: orgId, ...rootAuth });
  record(
    "restricted session visible to root",
    (rootListShare.json?.sessions ?? []).some((s) => s.id === restrictedRowId)
  );
  assertError(
    "non-grantee member cannot read restricted segments",
    await rpc("orgii_get_session_event_segments", {
      p_org_id: orgId, ...memberAuthC, session_row_id: restrictedRowId, after_seq: 0,
    }),
    "ORGII_UNAUTHORIZED"
  );

  // Directed share: B → C. Creation bumps updated_at (delta pickup, §6.5).
  assertError(
    "non-owner cannot create a share on B's session",
    await rpc("orgii_create_session_share", {
      p_org_id: orgId, ...memberAuthA, session_row_id: restrictedRowId,
      grantee_member_id: cId, share_token_hash: null, level: "replay", expires_at: null,
    }),
    "ORGII_UNAUTHORIZED"
  );
  assertError(
    "share must be directed XOR link (both set rejected)",
    await rpc("orgii_create_session_share", {
      p_org_id: orgId, ...memberAuthB, session_row_id: restrictedRowId,
      grantee_member_id: cId, share_token_hash: sha256(randomHex()), level: "replay", expires_at: null,
    }),
    "ORGII_UNAUTHORIZED"
  );
  const directedShare = await rpc("orgii_create_session_share", {
    p_org_id: orgId, ...memberAuthB, session_row_id: restrictedRowId,
    grantee_member_id: cId, share_token_hash: null, level: "replay", expires_at: null,
  });
  assertOk("B creates a directed share for C", directedShare, (j) => typeof j === "string" && j.length > 0);
  const cDelta = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthC, since_timestamp: preShareTime });
  record(
    "directed share bumps updated_at (restricted row arrives in C's delta)",
    (cDelta.json?.sessions ?? []).some((s) => s.id === restrictedRowId)
  );
  assertOk(
    "grantee C reads restricted segments",
    await rpc("orgii_get_session_event_segments", {
      p_org_id: orgId, ...memberAuthC, session_row_id: restrictedRowId, after_seq: 0,
    }),
    (j) => j?.epoch === 1 && (j?.segments ?? []).length === 2
  );

  // Revoke: bumps updated_at again; C loses list visibility and segment access.
  const preRevoke = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthC });
  const preRevokeTime = preRevoke.json?.serverTime;
  assertOk(
    "B revokes the directed share",
    await rpc("orgii_revoke_session_share", { p_org_id: orgId, ...memberAuthB, share_id: directedShare.json }),
    () => true
  );
  const cAfterRevoke = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthC });
  record(
    "revoked share hides the restricted session from C again",
    !(cAfterRevoke.json?.sessions ?? []).some((s) => s.id === restrictedRowId)
  );
  const bRevokeDelta = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthB, since_timestamp: preRevokeTime });
  record(
    "revoke bumps updated_at (owner's delta re-carries the row)",
    (bRevokeDelta.json?.sessions ?? []).some((s) => s.id === restrictedRowId)
  );
  assertError(
    "revoked grantee cannot read restricted segments",
    await rpc("orgii_get_session_event_segments", {
      p_org_id: orgId, ...memberAuthC, session_row_id: restrictedRowId, after_seq: 0,
    }),
    "ORGII_UNAUTHORIZED"
  );

  // Link share: token resolves the session and fetches segments — anon only.
  const linkToken = randomHex();
  const linkShare = await rpc("orgii_create_session_share", {
    p_org_id: orgId, ...memberAuthB, session_row_id: restrictedRowId,
    grantee_member_id: null, share_token_hash: sha256(linkToken), level: "replay", expires_at: null,
  });
  assertOk("B creates a link share", linkShare, (j) => typeof j === "string" && j.length > 0);
  const resolved = await rpc("orgii_resolve_session_share", { share_token: linkToken });
  assertOk(
    "share token resolves the bound session (no member credential)",
    resolved,
    (j) => j?.id === restrictedRowId && j?.eventsEpoch === 1 && j?.eventsCount === 2
  );
  assertOk(
    "share token fetches the bound session's segments",
    await rpc("orgii_get_session_event_segments", {
      p_org_id: orgId, session_row_id: restrictedRowId, after_seq: 0, p_share_token: linkToken,
    }),
    (j) => j?.epoch === 1 && (j?.segments ?? []).length === 2
  );
  assertError(
    "token bound to session A cannot fetch session B's segments",
    await rpc("orgii_get_session_event_segments", {
      p_org_id: orgId, session_row_id: sessionRowId, after_seq: 0, p_share_token: linkToken,
    }),
    "ORGII_UNAUTHORIZED"
  );
  assertError(
    "garbage token → uniform error",
    await rpc("orgii_resolve_session_share", { share_token: randomHex() }),
    "ORGII_UNAUTHORIZED"
  );
  const expiredToken = randomHex();
  await rpc("orgii_create_session_share", {
    p_org_id: orgId, ...memberAuthB, session_row_id: restrictedRowId,
    grantee_member_id: null, share_token_hash: sha256(expiredToken), level: "replay",
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  assertError(
    "expired token → uniform error",
    await rpc("orgii_resolve_session_share", { share_token: expiredToken }),
    "ORGII_UNAUTHORIZED"
  );
  const metadataToken = randomHex();
  await rpc("orgii_create_session_share", {
    p_org_id: orgId, ...memberAuthB, session_row_id: restrictedRowId,
    grantee_member_id: null, share_token_hash: sha256(metadataToken), level: "metadata", expires_at: null,
  });
  assertError(
    "metadata-level token cannot resolve replay (level gate)",
    await rpc("orgii_resolve_session_share", { share_token: metadataToken }),
    "ORGII_UNAUTHORIZED"
  );
  assertOk(
    "B revokes the link share",
    await rpc("orgii_revoke_session_share", { p_org_id: orgId, ...memberAuthB, share_id: linkShare.json }),
    () => true
  );
  assertError(
    "revoked token → uniform error",
    await rpc("orgii_resolve_session_share", { share_token: linkToken }),
    "ORGII_UNAUTHORIZED"
  );
  assertError(
    "revoked token cannot fetch segments either",
    await rpc("orgii_get_session_event_segments", {
      p_org_id: orgId, session_row_id: restrictedRowId, after_seq: 0, p_share_token: linkToken,
    }),
    "ORGII_UNAUTHORIZED"
  );

  // Owner management listing: shares visible, token hashes never returned.
  const shareList = await rpc("orgii_list_session_shares", {
    p_org_id: orgId, ...memberAuthB, session_row_id: restrictedRowId,
  });
  assertOk(
    "owner lists active + revoked shares",
    shareList,
    (j) => Array.isArray(j) && j.length === 4 &&
      j.some((s) => s.granteeMemberId === cId && s.revokedAt) &&
      j.some((s) => s.hasToken === true)
  );
  record(
    "share listing carries no token hashes",
    !JSON.stringify(shareList.json ?? []).includes(sha256(linkToken)) &&
      !JSON.stringify(shareList.json ?? []).includes("share_token_hash") &&
      !JSON.stringify(shareList.json ?? []).includes("shareTokenHash")
  );
  assertError(
    "non-owner cannot list shares",
    await rpc("orgii_list_session_shares", {
      p_org_id: orgId, ...memberAuthC, session_row_id: restrictedRowId,
    }),
    "ORGII_UNAUTHORIZED"
  );

  // Tombstoned session: resolve dies with the same uniform error.
  const doomedToken = randomHex();
  await rpc("orgii_create_session_share", {
    p_org_id: orgId, ...memberAuthB, session_row_id: restrictedRowId,
    grantee_member_id: null, share_token_hash: sha256(doomedToken), level: "replay", expires_at: null,
  });
  assertOk(
    "B tombstones the restricted session",
    await rpc("orgii_remove_session_metadata", {
      p_org_id: orgId, ...memberAuthB, owner_member_id: bId, source_session_id: restrictedSourceId,
    }),
    () => true
  );
  assertError(
    "token on a tombstoned session → uniform error",
    await rpc("orgii_resolve_session_share", { share_token: doomedToken }),
    "ORGII_UNAUTHORIZED"
  );
  const cAfterTombstone = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthC });
  record(
    "restricted tombstone stays invisible to non-grantees (no widening through death)",
    !(cAfterTombstone.json?.sessions ?? []).some((s) => s.id === restrictedRowId)
  );
  const rootAfterTombstone = await rpc("orgii_list_org_state", { p_org_id: orgId, ...rootAuth });
  record(
    "restricted tombstone still reaches root",
    (rootAfterTombstone.json?.sessions ?? []).some((s) => s.id === restrictedRowId && s.deletedAt)
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

  // ---- M6: work item prefix is admin-gated (design §16.9) ----
  // The prefix names every short id the allocator mints, so changing it on
  // an existing project is an admin operation (mirrors orgii_delete_project).
  assertError(
    "non-admin cannot change the work item prefix",
    await rpc("orgii_upsert_project", {
      p_org_id: orgId, ...memberAuthB, base_version: 2,
      project: { id: projectId, orgId, name: "P v2", slug: `p-${run}`, status: "in_progress", workItemPrefix: "AUT" },
    }),
    "ORGII_UNAUTHORIZED"
  );
  assertOk(
    "admin sets the work item prefix (v3)",
    await rpc("orgii_upsert_project", {
      p_org_id: orgId, ...memberAuthA, base_version: 2,
      project: { id: projectId, orgId, name: "P v2", slug: `p-${run}`, status: "in_progress", workItemPrefix: "AUT" },
    }),
    (j) => j?.version === 3
  );
  assertOk(
    "non-admin edit with the prefix unchanged still passes (v4)",
    await rpc("orgii_upsert_project", {
      p_org_id: orgId, ...memberAuthB, base_version: 3,
      project: { id: projectId, orgId, name: "P v4 member edit", slug: `p-${run}`, status: "in_progress", workItemPrefix: "AUT" },
    }),
    (j) => j?.version === 4
  );

  // ---- M6: short-id allocator (design §16.5) ----
  const alloc1 = await rpc("orgii_allocate_work_item_short_id", {
    p_org_id: orgId, ...memberAuthA, project_id: projectId,
  });
  assertOk("allocator returns PREFIX-0001", alloc1, (j) => j?.shortId === "AUT-0001" && j?.n === 1);
  const alloc2 = await rpc("orgii_allocate_work_item_short_id", {
    p_org_id: orgId, ...memberAuthB, project_id: projectId,
  });
  assertOk(
    "second allocation increments (never reuses)",
    alloc2,
    (j) => j?.shortId === "AUT-0002" && j?.n === 2
  );
  assertError(
    "allocator rejects non-members",
    await rpc("orgii_allocate_work_item_short_id", {
      p_org_id: orgId, p_member_id: `member-ghost-${run}`, p_member_token: randomHex(), project_id: projectId,
    }),
    "ORGII_UNAUTHORIZED"
  );
  assertError(
    "allocator on unknown project raises uniform conflict",
    await rpc("orgii_allocate_work_item_short_id", {
      p_org_id: orgId, ...memberAuthA, project_id: `proj-ghost-${run}`,
    }),
    "ORGII_CONFLICT"
  );
  const allocatedProject = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA });
  const allocatedRow = (allocatedProject.json?.projects ?? []).find((p) => p.id === projectId);
  record(
    "allocation does not bump the project row version (server-owned counter)",
    allocatedRow?.version === 4,
    `got version ${allocatedRow?.version}`
  );

  // ---- M6: counter advances past synced short ids (collision fix) ----
  // A work item that arrives through upsert with a higher numeric suffix
  // (offline-provisional id, import, pre-share row) must push the allocator
  // counter past it — otherwise the allocator would re-mint AUT-0007 for the
  // next caller and two rows would collide on the same display id.
  assertOk(
    "synced work item with an out-of-band short id lands",
    await rpc("orgii_upsert_work_item", {
      p_org_id: orgId, ...memberAuthB, base_version: null,
      work_item: {
        id: `wi-import-${run}`, projectId, shortId: "AUT-0007",
        title: "Imported item", body: "b", status: "backlog", priority: "none",
      },
    }),
    (j) => j?.version === 1
  );
  const alloc3 = await rpc("orgii_allocate_work_item_short_id", {
    p_org_id: orgId, ...memberAuthA, project_id: projectId,
  });
  assertOk(
    "allocator skips past the synced short id (counter advanced)",
    alloc3,
    (j) => j?.shortId === "AUT-0008" && j?.n === 8,
    `got ${JSON.stringify(alloc3.json)}`
  );
  const advancedProject = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA });
  const advancedRow = (advancedProject.json?.projects ?? []).find((p) => p.id === projectId);
  record(
    "counter advance does not bump the project row version",
    advancedRow?.version === 4,
    `got version ${advancedRow?.version}`
  );

  // ---- M6: work item OCC retry realism (design §16.4) ----
  // Row ids are a GLOBAL primary key across every org in the test DB, so the
  // id must be run-namespaced: a fixed "AUT-0001" collides with the row a
  // PREVIOUS harness run created under its own org, and the server (by
  // design) rejects the cross-org row-id hit with ORGII_CONFLICT.
  const workItemId = `wi-occ-${run}`;
  const workItemBase = {
    id: workItemId, projectId, shortId: "AUT-0031", title: "Item v1",
    body: "b", status: "backlog", priority: "none",
  };
  assertOk(
    "work item create returns version 1",
    await rpc("orgii_upsert_work_item", {
      p_org_id: orgId, ...memberAuthA, base_version: null, work_item: workItemBase,
    }),
    (j) => j?.version === 1
  );
  assertOk(
    "teammate update bumps to version 2",
    await rpc("orgii_upsert_work_item", {
      p_org_id: orgId, ...memberAuthB, base_version: 1,
      work_item: { ...workItemBase, title: "Teammate title" },
    }),
    (j) => j?.version === 2
  );
  assertError(
    "stale push (base 1) conflicts",
    await rpc("orgii_upsert_work_item", {
      p_org_id: orgId, ...memberAuthA, base_version: 1,
      work_item: { ...workItemBase, title: "Stale local title" },
    }),
    "ORGII_CONFLICT"
  );
  // Client-side recovery (§16.4): pull the fresh row, merge per-field
  // locally, re-push with the fresh base — second attempt succeeds.
  const freshState = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA });
  const freshRow = (freshState.json?.workItems ?? []).find((w) => w.id === workItemId);
  record("fresh remote row carries version 2", freshRow?.version === 2);
  assertOk(
    "re-push with fresh base succeeds (version 3)",
    await rpc("orgii_upsert_work_item", {
      p_org_id: orgId, ...memberAuthA, base_version: freshRow?.version ?? -1,
      work_item: { ...workItemBase, title: "Merged title", status: "in_progress" },
    }),
    (j) => j?.version === 3
  );

  // ---- M6: execution lock lifecycle (design §16.6) ----
  const acquired = await rpc("orgii_acquire_work_item_lock", {
    p_org_id: orgId, ...memberAuthA, work_item_id: workItemId,
    lock_payload: { activeSessionId: `session-${run}`, lockedByMemberId: bId /* spoof */ },
  });
  assertOk("member acquires the free lock", acquired, (j) => Number(j) === 4);
  const lockedState = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA });
  const lockedRow = (lockedState.json?.workItems ?? []).find((w) => w.id === workItemId);
  record(
    "lock holder forced to authenticated member (spoof ignored)",
    lockedRow?.executionLock?.lockedByMemberId === aId,
    `got ${JSON.stringify(lockedRow?.executionLock)}`
  );
  record(
    "acquire stamps a server lockedAt (TTL anchor)",
    typeof lockedRow?.executionLock?.lockedAt === "string" && lockedRow.executionLock.lockedAt.length > 0,
    `got ${JSON.stringify(lockedRow?.executionLock?.lockedAt)}`
  );
  assertError(
    "second acquire while held conflicts",
    await rpc("orgii_acquire_work_item_lock", {
      p_org_id: orgId, ...memberAuthB, work_item_id: workItemId, lock_payload: { activeSessionId: "other" },
    }),
    "ORGII_CONFLICT"
  );
  assertOk(
    "holder re-acquire is idempotent (heartbeat, version 5)",
    await rpc("orgii_acquire_work_item_lock", {
      p_org_id: orgId, ...memberAuthA, work_item_id: workItemId,
      lock_payload: { activeSessionId: `session-${run}-2` },
    }),
    (j) => Number(j) === 5
  );
  // executionLock is SERVER-OWNED: a whole-row upsert (here with a spoofed
  // lock aimed at hijacking the holder) must not touch the stored lock —
  // only acquire/release mutate it.
  assertOk(
    "whole-row upsert while locked succeeds (version 6)",
    await rpc("orgii_upsert_work_item", {
      p_org_id: orgId, ...memberAuthB, base_version: 5,
      work_item: {
        ...workItemBase, title: "Pushed during lock",
        executionLock: { lockedByMemberId: bId, activeSessionId: "hijack" },
      },
    }),
    (j) => j?.version === 6
  );
  const afterPushState = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA });
  const afterPushRow = (afterPushState.json?.workItems ?? []).find((w) => w.id === workItemId);
  record(
    "client-sent executionLock cannot clobber the stored lock (server-owned)",
    afterPushRow?.executionLock?.lockedByMemberId === aId &&
      afterPushRow?.executionLock?.activeSessionId === `session-${run}-2`,
    `got ${JSON.stringify(afterPushRow?.executionLock)}`
  );
  assertError(
    "non-holder member cannot release",
    await rpc("orgii_release_work_item_lock", {
      p_org_id: orgId, ...memberAuthB, work_item_id: workItemId,
    }),
    "ORGII_UNAUTHORIZED"
  );
  assertOk(
    "holder releases the lock",
    await rpc("orgii_release_work_item_lock", {
      p_org_id: orgId, ...memberAuthA, work_item_id: workItemId,
    }),
    (j) => Number(j) === 7
  );
  assertOk(
    "release when unlocked is idempotent (version unchanged)",
    await rpc("orgii_release_work_item_lock", {
      p_org_id: orgId, ...memberAuthA, work_item_id: workItemId,
    }),
    (j) => Number(j) === 7
  );
  assertOk(
    "member B acquires after release",
    await rpc("orgii_acquire_work_item_lock", {
      p_org_id: orgId, ...memberAuthB, work_item_id: workItemId, lock_payload: { activeSessionId: "b-session" },
    }),
    (j) => Number(j) === 8
  );
  assertOk(
    "admin force-releases another member's lock",
    await rpc("orgii_release_work_item_lock", {
      p_org_id: orgId, ...memberAuthA, work_item_id: workItemId,
    }),
    (j) => Number(j) === 9
  );

  // ---- M6: stale-lock takeover (30-minute TTL) ----
  // lockedAt is server-stamped but a PAST client value is honored (clamped
  // to now() at most — pre-dating only weakens your own lease), which is
  // exactly what lets this test age a lock without waiting 30 minutes.
  assertOk(
    "B acquires with a pre-dated lease (version 10)",
    await rpc("orgii_acquire_work_item_lock", {
      p_org_id: orgId, ...memberAuthB, work_item_id: workItemId,
      lock_payload: {
        activeSessionId: "b-stale",
        lockedAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      },
    }),
    (j) => Number(j) === 10
  );
  assertOk(
    "another member takes over the stale lease (version 11)",
    await rpc("orgii_acquire_work_item_lock", {
      p_org_id: orgId, ...memberAuthC, work_item_id: workItemId,
      lock_payload: { activeSessionId: "c-takeover" },
    }),
    (j) => Number(j) === 11
  );
  const takeoverState = await rpc("orgii_list_org_state", { p_org_id: orgId, ...memberAuthA });
  const takeoverRow = (takeoverState.json?.workItems ?? []).find((w) => w.id === workItemId);
  record(
    "takeover re-stamps holder and lease",
    takeoverRow?.executionLock?.lockedByMemberId === cId &&
      takeoverRow?.executionLock?.activeSessionId === "c-takeover",
    `got ${JSON.stringify(takeoverRow?.executionLock)}`
  );
  assertError(
    "fresh lease still conflicts for non-holders",
    await rpc("orgii_acquire_work_item_lock", {
      p_org_id: orgId, ...memberAuthB, work_item_id: workItemId, lock_payload: { activeSessionId: "b-again" },
    }),
    "ORGII_CONFLICT"
  );
  assertOk(
    "admin force-releases the takeover lock (cleanup)",
    await rpc("orgii_release_work_item_lock", {
      p_org_id: orgId, ...memberAuthA, work_item_id: workItemId,
    }),
    (j) => Number(j) === 12
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
